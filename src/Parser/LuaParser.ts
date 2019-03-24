import * as luaparse from 'luaparse';
import {LuaScope} from './LocalData';
import {GlobalData, LuaPrimitive, LuaVariable, LuaFunction, LuaMemberFunction, LuaMemberVariable, LuaHook} from './GlobalData';

enum NodeType {
	AssignmentStatement,
	BinaryExpression,
	BooleanLiteral,
	BreakStatement,
	CallExpression,
	CallStatement,
	Chunk,
	Comment,
	ContinueStatement,
	DoStatement,
	ElseClause,
	ElseifClause,
	ForGenericStatement,
	ForNumericStatement,
	FunctionDeclaration,
	GotoStatement,
	Identifier,
	IfClause,
	IfStatement,
	IndexExpression,
	LabelStatement,
	LocalStatement,
	LogicalExpression,
	MemberExpression,
	NilLiteral,
	NumericLiteral,
	RepeatStatement,
	ReturnStatement,
	StringCallExpression,
	StringLiteral,
	TableCallExpression,
	TableConstructorExpression,
	TableKey,
	TableKeyString,
	TableValue,
	UnaryExpression,
	VarargLiteral,
	WhileStatement
}

function parseType(type: string): NodeType{
	return (<any> NodeType)[type]; // wtf typescript
}

function is(node: any, type: NodeType){
	return parseType(node.type) === type;
}

function isAny(node: any, ...args: NodeType[]){
	let nodeType = parseType(node.type);
	return args.includes(nodeType);
}

class LuaParser {
	readonly data: GlobalData = new GlobalData();

	topScope?: LuaScope;

	private fileId: string;

	private static valueTypeFromType(type: string): LuaPrimitive{
		switch(parseType(type)){
			case NodeType.StringLiteral:
				return LuaPrimitive.string;
			case NodeType.NumericLiteral:
				return LuaPrimitive.number;
			case NodeType.BooleanLiteral:
				return LuaPrimitive.boolean;
			case NodeType.TableConstructorExpression:
				return LuaPrimitive.table;
			default:
				return LuaPrimitive.any;
		}
	}
	
	/** Parses function information into data */
	private parseFunction(node: any, scope: LuaScope){
		if(node.isLocal){
			return;
		}
	
		// function asdf() end
		if(is(node.identifier, NodeType.Identifier)){
			if(scope.isLocal(node.identifier.name)){
				return;
			}

			this.data.functions.push(new LuaFunction(
				node.identifier.name,
				node.parameters.map((param: any) => param.name),
				node.loc.start.line,
				this.fileId
			));
		}
		// function GM:Asdf() end
		else if(is(node.identifier, NodeType.MemberExpression)){
			let tableName = node.identifier.base.name;
			if(!tableName){
				return; // This is too complex of an expression for me to handle (e.g. function GM.asdf:Test())
			}
			if(scope.isLocal(tableName)){
				return;
			}

			let isMeta = false;
			if(scope.hasMetaTable(tableName)){
				isMeta = true;
				tableName = scope.translateMetaTable(tableName);
			}

			this.data.memberFunctions.push(new LuaMemberFunction(
				isMeta,
				tableName,
				node.identifier.indexer,
				new LuaFunction(
					node.identifier.identifier.name,
					node.parameters.map((param: any) => param.name),
					node.loc.start.line,
					this.fileId
				)
			));
		}
	}
	
	/** Parses assignment information into data */
	private parseAssignment(node: any, scope: LuaScope){
		node.variables.forEach((variable: any, key: number) => {
			if(!node.init[key]){
				return;
			}
			let init = node.init[key];
	
			// GM.Asdf, GM.Bsdf = 1234, function(asdf) end
			if(is(variable, NodeType.MemberExpression)){
				let tableName = variable.base.name;
				if(!tableName){
					return; // This is too complex of an expression for me to handle (e.g. self.test[asdf].test = 1)
				}
				if(scope.isLocal(tableName)){
					return;
				}

				let isMeta = false;
				if(scope.hasMetaTable(tableName)){
					isMeta = true;
					tableName = scope.translateMetaTable(tableName);
				}

				// GM.Asdf = function(asdf) end
				if(is(init, NodeType.FunctionDeclaration)){
					this.data.memberFunctions.push(new LuaMemberFunction(
						isMeta,
						tableName,
						".",
						new LuaFunction(
							variable.identifier.name,
							init.parameters.map((param: any) => param.name),
							variable.loc.start.line,
							this.fileId
						)
					));
				}
				// GM.Asdf = 1234
				else{
					this.data.memberVariables.push(new LuaMemberVariable(
						isMeta,
						tableName,
						new LuaVariable(
							LuaParser.valueTypeFromType(init.type),
							variable.identifier.name,
							variable.loc.start.line,
							this.fileId
						)
					));
				}
			}
			// Asdf = 1234
			else if(is(variable, NodeType.Identifier)){
				if(scope.isLocal(variable.name)){
					return;
				}
	
				// Asdf = function(asdf) end
				if(is(init, NodeType.FunctionDeclaration)){
					this.data.functions.push(new LuaFunction(
						variable.name,
						init.parameters.map((param: any) => param.name),
						variable.loc.start.line,
						this.fileId
					));
				}
				// Asdf = 1234
				else{
					this.data.variables.push(new LuaVariable(
						LuaParser.valueTypeFromType(init.type),
						variable.name,
						variable.loc.start.line,
						this.fileId
					));
				}
			}
		});
	}
	
	/** Attempts to find a FindMetaTable definition in the current assignment, adds to data if hook found. Assumes node is an assignment. */
	private parseMeta(node: any, scope: LuaScope){
		// Identify "local asdf = FindMetaTable("Player")" statements
		node.variables.forEach((variable: any, key: number) => {
			if(!node.init[key]){
				return;
			}
			let init = node.init[key];
	
			if(is(variable, NodeType.Identifier) &&
				is(init, NodeType.CallExpression) &&
				init.base.name &&
				init.base.name === "FindMetaTable" &&
				init.arguments.length === 1 &&
				is(init.arguments[0], NodeType.StringLiteral)){
				let metaType = init.arguments[0].value;
	
				scope.addMetaTable(variable.name, metaType);
			}
		});
	}
	
	/** Attempts to find a hook.Run/hook.Call in the current assignment, adds to data if hook found. Assumes node is an assignment or direct call. */
	private parseHook(node: any, scope: LuaScope){
		function parseExpression(parser: LuaParser, node: any, data: any){
			if(!is(node, NodeType.CallExpression)){
				return;
			}
	
			if(is(node.base, NodeType.MemberExpression) &&
				node.arguments.length >= 1 &&
				is(node.base.base, NodeType.Identifier) &&
				node.base.base.name === "hook" &&
				is(node.base.identifier, NodeType.Identifier) &&
				(node.base.identifier.name === "Run" ||
					node.base.identifier.name === "Call")){
				let isHookRun = node.base.identifier.name === "Run";
				let hookName = node.arguments[0].value;
				let params = node.arguments.slice(isHookRun ? 1 : 2).map((param: any, index: number) => param.name ? param.name : `arg${index + 1}`);
				
				parser.data.hooks.push(new LuaHook(
					hookName,
					params,
					node.loc.start.line,
					parser.fileId
				));
			}
		}
	
		//hook.Run("")
		if(is(node, NodeType.CallStatement)){
			parseExpression(this, node.expression, this.data);
		}
		//local a = hook.Run("")
		else if(isAny(node, NodeType.LocalStatement, NodeType.AssignmentStatement)){
			node.init.forEach((init: any) => {
				parseExpression(this, init, this.data);
			});
		}
	}
	
	/** Parses function parameters into the supplied scope. Assumes node is a FunctionDeclaration */
	private parseFunctionParameters(node: any, scope: LuaScope){
		if(is(node.identifier, NodeType.MemberExpression) && node.identifier.indexer === ":"){
			scope.addSelf();
		}
	
		node.parameters.forEach((parameter: any) => {
			let name;
			if(is(parameter, NodeType.Identifier)){
				name = parameter.name;
			}
			else if(is(parameter, NodeType.VarargLiteral)){
				name = "...";
			}
			else{
				return;
			}
	
			scope.addLocal(name);
			scope.addParameter(name);
		});
	}
	
	/** Parses loop variables into the supplied scope. Assumes node is a for-loop */
	private parseLoopParameters(node: any, scope: LuaScope){
		if(is(node, NodeType.ForGenericStatement)){
			node.variables.forEach((variable: any) => {
				if(is(variable, NodeType.Identifier)){ // not sure if it can be anything else but always good to check
					scope.addLocal(variable.name);
				}
			});
		}
		else if(is(node, NodeType.ForNumericStatement) && is(node.variable, NodeType.Identifier)){
			scope.addLocal(node.variable.name);
		}
	}
	
	/** Parses local assignment into the supplied scope. Assumes node is a LocalStatement. */
	private parseLocal(node: any, scope: LuaScope){
		node.variables.forEach((variable: any) => {
			if(is(variable, NodeType.Identifier)){
				if(this.data.variables.some(v => v.name === variable.name)){
					// This is already a global variable
					// This might bite me in the ass, but CTP for example does "ctp = ctp or {}; local ctp = ctp" which means we think ctp is now
					// a local variable. This is only possible to fix via actually interpreting the lua I guess.
					return;
				}
	
				scope.addLocal(variable.name);
			}
		});
	}

	private parseBody(node: any, scope: LuaScope){	
		// If this body has inner bodies, traverse them
		if(node.body){
			let localScope = new LuaScope(node.loc.start.line, node.loc.end.line, scope);

			// Parse function parameters into the new scope
			if(is(node, NodeType.FunctionDeclaration)){
				this.parseFunctionParameters(node, localScope);
			}
		
			if(isAny(node, NodeType.ForGenericStatement, NodeType.ForNumericStatement)){
				this.parseLoopParameters(node, localScope);
			}
	
			// Recursively parse inner bodies
			node.body.forEach((bodyItem: any) => {
				this.parseBody(bodyItem, localScope);
			});
		}
	
		// If this is an if statement, traverse all parts of it
		if(is(node, NodeType.IfStatement)){
			node.clauses.forEach((clause: any) => {
				if(clause.body){
					let localScope = new LuaScope(node.loc.start.line, node.loc.end.line, scope);
	
					clause.body.forEach((bodyItem: any) => {
						this.parseBody(bodyItem, localScope);
					});
				}
			});
		}
	
		if(is(node, NodeType.LocalStatement)){
			this.parseLocal(node, scope);
		}
	
		if(isAny(node, NodeType.LocalStatement, NodeType.AssignmentStatement, NodeType.CallStatement)){
			this.parseHook(node, scope);
		}
		
		if(isAny(node, NodeType.LocalStatement, NodeType.AssignmentStatement)){
			this.parseMeta(node, scope);
		}
	
		if(is(node, NodeType.AssignmentStatement)){
			this.parseAssignment(node, scope);
		}
		
		if(is(node, NodeType.FunctionDeclaration)){
			this.parseFunction(node, scope);
		}
	}

	public parseLua(code: string){
		let ast = luaparse.parse(code, {
			locations: true
		});

		if(!is(ast, NodeType.Chunk)) {
			return false;
		}

		let topScope = new LuaScope(ast.loc.start.line, ast.loc.end.line);
		this.topScope = topScope;

		ast.body.forEach((bodyItem: any) => {
			this.parseBody(bodyItem, topScope);
		});
	}

	constructor(fileId: string){
		this.fileId = fileId;
	}
}

export {LuaParser};
