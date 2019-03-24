import * as luaparse from 'luaparse';
import {LuaScope} from './LocalData';
import {GlobalData, LuaPrimitive, LuaVariable, LuaFunction, LuaMemberFunction, LuaMemberVariable, LuaHook} from './GlobalData';

class LuaParser {
	readonly data: GlobalData = new GlobalData();

	topScope?: LuaScope;

	private fileId: string;

	private static valueTypeFromType(type: string): LuaPrimitive{
		switch(type){
			case "StringLiteral":
				return LuaPrimitive.string;
			case "NumericLiteral":
				return LuaPrimitive.number;
			case "BooleanLiteral":
				return LuaPrimitive.boolean;
			case "TableConstructorExpression":
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
		if(node.identifier.type === "Identifier"){
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
		else if(node.identifier.type === "MemberExpression"){
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
			if(variable.type === "MemberExpression"){
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
				if(init.type === "FunctionDeclaration"){
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
			else if(variable.type === "Identifier"){
				if(scope.isLocal(variable.name)){
					return;
				}
	
				// Asdf = function(asdf) end
				if(init.type === "FunctionDeclaration"){
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
	
			if(variable.type === "Identifier" &&
				init.type === "CallExpression" &&
				init.base.name &&
				init.base.name === "FindMetaTable" &&
				init.arguments.length === 1 &&
				init.arguments[0].type === "StringLiteral"){
				let metaType = init.arguments[0].value;
	
				scope.addMetaTable(variable.name, metaType);
			}
		});
	}
	
	/** Attempts to find a hook.Run/hook.Call in the current assignment, adds to data if hook found. Assumes node is an assignment or direct call. */
	private parseHook(node: any, scope: LuaScope){
		function parseExpression(parser: LuaParser, node: any, data: any){
			if(node.type !== "CallExpression"){
				return;
			}
	
			if(node.base.type === "MemberExpression" &&
				node.arguments.length >= 1 &&
				node.base.base.type === "Identifier" &&
				node.base.base.name === "hook" &&
				node.base.identifier.type === "Identifier" &&
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
		if(node.type === "CallStatement"){
			parseExpression(this, node.expression, this.data);
		}
		//local a = hook.Run("")
		else if(node.type === "LocalStatement" || node.type === "AssignmentStatement"){
			node.init.forEach((init: any) => {
				parseExpression(this, init, this.data);
			});
		}
	}
	
	/** Parses function parameters into the supplied scope. Assumes node is a FunctionDeclaration */
	private parseFunctionParameters(node: any, scope: LuaScope){
		if(node.identifier.type === "MemberExpression" && node.identifier.indexer === ":"){
			scope.addSelf();
		}
	
		node.parameters.forEach((parameter: any) => {
			let name;
			if(parameter.type === "Identifier"){
				name = parameter.name;
			}
			else if(parameter.type === "VarargLiteral"){
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
		if(node.type === "ForGenericStatement"){
			node.variables.forEach((variable: any) => {
				if(variable.type === "Identifier"){ // not sure if it can be anything else but always good to check
					scope.addLocal(variable.name);
				}
			});
		}
		else if(node.type === "ForNumericStatement"){
			if(node.variable.type === "Identifier"){
				scope.addLocal(node.variable.name);
			}
		}
	}
	
	/** Parses local assignment into the supplied scope. Assumes node is a LocalStatement. */
	private parseLocal(node: any, scope: LuaScope){
		node.variables.forEach((variable: any) => {
			if(variable.type === "Identifier"){
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
			if(node.type === "FunctionDeclaration"){
				this.parseFunctionParameters(node, localScope);
			}
		
			if(node.type === "ForGenericStatement" || node.type === "ForNumericStatement"){
				this.parseLoopParameters(node, localScope);
			}
	
			// Recursively parse inner bodies
			node.body.forEach((bodyItem: any) => {
				this.parseBody(bodyItem, localScope);
			});
		}
	
		// If this is an if statement, traverse all parts of it
		if(node.type === "IfStatement"){
			node.clauses.forEach((clause: any) => {
				if(clause.body){
					let localScope = new LuaScope(node.loc.start.line, node.loc.end.line, scope);
	
					clause.body.forEach((bodyItem: any) => {
						this.parseBody(bodyItem, localScope);
					});
				}
			});
		}
	
		if(node.type === "LocalStatement"){
			this.parseLocal(node, scope);
		}
	
		if(node.type === "LocalStatement" || node.type === "AssignmentStatement" || node.type === "CallStatement"){
			this.parseHook(node, scope);
		}
		
		if(node.type === "LocalStatement" || node.type === "AssignmentStatement"){
			this.parseMeta(node, scope);
		}
	
		if(node.type === "AssignmentStatement"){
			this.parseAssignment(node, scope);
		}
		
		if(node.type === "FunctionDeclaration"){
			this.parseFunction(node, scope);
		}
	}

	public parseLua(code: string){
		let ast = luaparse.parse(code, {
			locations: true
		});

		if(ast.type !== "Chunk") {
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
