import * as luaparse from 'luaparse';
import {GlobalData, LuaPrimitive, LuaVariable, LuaFunction, LuaMemberFunction, LuaMemberVariable, LuaHook} from './GlobalData';

class LuaParser {
	readonly data: GlobalData = new GlobalData();

	private fileId: string;

	// Maps a local variable name to a metatable name, e.g. "plymeta => Player"
	private metaTables: {[varName: string]: string} = {};

	private static deepCopy(t: any){
		return JSON.parse(JSON.stringify(t));
	}

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
	
	private isLocal(name: string, scope: any){
		if(this.metaTables[name]){
			return false;
		}
	
		if(scope.locals[name]){
			return true;
		}
	
		return false;
	}
	
	/** Parses function information into data */
	private parseFunction(node: any, scope: any){
		if(node.isLocal){
			return;
		}
	
		// function asdf() end
		if(node.identifier.type === "Identifier"){
			if(this.isLocal(node.identifier.name, scope)){
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
			if(this.isLocal(tableName, scope)){
				return;
			}

			let isMeta = false;
			if(this.metaTables[tableName]){
				isMeta = true;
				tableName = this.metaTables[tableName];
			}

			this.data.memberFunctions.push(new LuaMemberFunction(
				isMeta,
				tableName,
				":",
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
	private parseAssignment(node: any, scope: any){
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
				if(this.isLocal(tableName, scope)){
					return;
				}

				let isMeta = false;
				if(this.metaTables[tableName]){
					isMeta = true;
					tableName = this.metaTables[tableName];
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
				if(this.isLocal(variable.name, scope)){
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
	private parseMeta(node: any, scope: any){
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
	
				this.metaTables[variable.name] = metaType;
			}
		});
	}
	
	/** Attempts to find a hook.Run/hook.Call in the current assignment, adds to data if hook found. Assumes node is an assignment or direct call. */
	private parseHook(node: any, scope: any){
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
	private parseFunctionParameters(node: any, scope: any){
		if(node.identifier.type === "MemberExpression" && node.identifier.indexer === ":"){
			scope.parameters["self"] = true;
			scope.locals["self"] = true;
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
	
			scope.parameters[name] = true;
			scope.locals[name] = true; // Add as local aswell since it should be treated as locals
		});
	}
	
	/** Parses loop variables into the supplied scope. Assumes node is a for-loop */
	private parseLoopParameters(node: any, scope: any){
		if(node.type === "ForGenericStatement"){
			node.variables.forEach((variable: any) => {
				if(variable.type === "Identifier"){ // not sure if it can be anything else but always good to check
					scope.locals[variable.name] = true;
				}
			});
		}
		else if(node.type === "ForNumericStatement"){
			if(node.variable.type === "Identifier"){
				scope.locals[node.variable.name] = true;
			}
		}
	}
	
	/** Parses local assignment into the supplied scope. Assumes node is a LocalStatement. */
	private parseLocal(node: any, scope: any){
		node.variables.forEach((variable: any) => {
			if(variable.type === "Identifier"){
				if(this.data.variables.some(v => v.name === variable.name)){
					// This is already a global variable
					// This might bite me in the ass, but CTP for example does "ctp = ctp or {}; local ctp = ctp" which means we think ctp is now
					// a local variable. This is only possible to fix via actually interpreting the lua I guess.
					return;
				}
	
				scope.locals[variable.name] = true;
			}
		});
	}

	private parseBody(node: any, scope: any){
		// Parse function parameters into the scope
		if(node.type === "FunctionDeclaration"){
			this.parseFunctionParameters(node, scope);
		}
	
		if(node.type === "ForGenericStatement" || node.type === "ForNumericStatement"){
			this.parseLoopParameters(node, scope);
		}
	
		// If this body has inner bodies, traverse them
		if(node.body){
			let localScope = LuaParser.deepCopy(scope); // Create a new child scope inside this body
	
			node.body.forEach((bodyItem: any) => {
				this.parseBody(bodyItem, localScope);
			});
		}
	
		// If this is an if statement, traverse all parts of it
		if(node.type === "IfStatement"){
			node.clauses.forEach((clause: any) => {
				if(clause.body){
					let localScope = LuaParser.deepCopy(scope); // Create a new child scope inside this clause
	
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

		let scope = {
			locals: {}, // local variables
			parameters: {}, // local function parameters
		};

		this.parseBody(ast, scope);
	}

	constructor(fileId: string){
		this.fileId = fileId;
	}
}

export {LuaParser};
