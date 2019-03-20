
import * as vscode from 'vscode';
import * as luaparse from 'luaparse';
import { basename } from 'path';

function isValue(type: string){
	try{
		valueTypeFromType(type);
	}catch(e){
		return false;
	}
	return true;
}

function valueTypeFromType(type: string){
	switch(type){
		case "StringLiteral":
			return "string";
		case "NumericLiteral":
			return "number";
		case "BooleanLiteral":
			return "boolean";
		case "TableConstructorExpression":
			return "table";
	}
	throw new Error("Type " + type + " is not a value type!");
}

function parseFunction(node: any, data: any){
	if(node.type !== "FunctionDeclaration"){
		return;
	}

	if(node.isLocal){
		return;
	}

	// function asdf() end
	if(node.identifier.type === "Identifier"){
		data.globalFunctions.push({
			name: node.identifier.name,
			line: node.loc.start.line,
			parameters: node.parameters.map((param: any) => param.name)
		});
	}
	// function GM:Asdf() end
	else if(node.identifier.type === "MemberExpression"){
		let memb = {
			type: "function",
			metaTable: null,
			table: null,
			name: node.identifier.identifier.name,
			line: node.loc.start.line,
			parameters: node.parameters.map((param: any) => param.name)
		}

		let tableName = node.identifier.base.name;
		if(data.metaTables[tableName]){
			memb.metaTable = data.metaTables[tableName];
		}
		else{
			memb.table = tableName;
		}

		data.globalMembers.push(memb);
	}
}

function parseAssignment(node: any, data: any){
	if(node.type !== "AssignmentStatement"){
		return;
	}

	node.variables.forEach((variable: any, key: number) => {
		if(!node.init[key]){
			return;
		}
		let init = node.init[key];

		// GM.Asdf, GM.Bsdf = 1234, function(asdf) end
		if(variable.type === "MemberExpression"){
			// GM.Asdf = function(asdf) end
			if(init.type === "FunctionDeclaration"){
				let memb = {
					type: "function",
					metaTable: null,
					table: null,
					name: variable.identifier.name,
					line: variable.loc.start.line,
					parameters: init.parameters.map((param: any) => param.name)
				}

				let tableName = variable.base.name;
				if(data.metaTables[tableName]){
					memb.metaTable = data.metaTables[tableName];
				}
				else{
					memb.table = tableName;
				}

				data.globalMembers.push(memb);
			}
			// GM.Asdf = 1234
			else if(isValue(init.type)){
				data.globalMembers.push({
					type: valueTypeFromType(init.type),
					table: variable.base.name,
					name: variable.identifier.name,
					line: variable.loc.start.line
				});
			}
			// GM.Asdf = somevariable
			else {
				data.globalMembers.push({
					type: "any",
					table: variable.base.name,
					name: variable.identifier.name,
					line: variable.loc.start.line
				});
			}
		}
		// Asdf = 1234
		else if(variable.type === "Identifier"){
			// Asdf = function(asdf) end
			if(init.type === "FunctionDeclaration"){
				data.globalFunctions.push({
					name: variable.name,
					line: variable.loc.start.line,
					parameters: init.parameters.map((param: any) => param.name)
				});
			}
			// Asdf = 1234
			else if(isValue(init.type)){
				data.globalVariables.push({
					type: valueTypeFromType(init.type),
					name: variable.name,
					line: variable.loc.start.line
				});
			}
			// Asdf = somevariable
			else {
				data.globalVariables.push({
					type: "any",
					name: variable.name,
					line: variable.loc.start.line
				});
			}
		}
	});
}

function parseMeta(node: any, data: any){
	if(node.type !== "LocalStatement" && node.type !== "AssignmentStatement"){
		return;
	}

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

			data.metaTables[variable.name] = metaType;
		}
	});
}

function parseHook(node: any, data: any){
	function parseExpression(node: any, data: any){
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
			let params = node.arguments.slice(isHookRun ? 1 : 2).map((param: any) => param.name);
			
			data.hooks[hookName] = {
				line: node.loc.start.line,
				parameters: params
			}
		}
	}

	//hook.Run("")
	if(node.type === "CallStatement"){
		parseExpression(node.expression, data);
	}
	//local a = hook.Run("")
	else if(node.type === "LocalStatement" || node.type === "AssignmentStatement"){
		node.init.forEach((init: any) => {
			parseExpression(init, data);
		});
	}
}

function parseBody(node: any, data: any){
	// If this body has inner bodies, traverse them
	if(node.body){
		node.body.forEach((bodyItem: any) => {
			parseBody(bodyItem, data);
		});
	}

	// If this is an if statement, traverse all parts of it
	if(node.type === "IfStatement"){
		node.clauses.forEach((clause: any) => {
			if(clause.body){
				clause.body.forEach((bodyItem: any) => {
					parseBody(bodyItem, data);
				});
			}
		});
	}

	parseHook(node, data);
	parseMeta(node, data);
	parseAssignment(node, data);
	parseFunction(node, data);
}

export function activate(context: vscode.ExtensionContext) {
	console.log("visual-code-glua-ide is now active!");

	vscode.workspace.findFiles('**/*.lua').then(
		files => {
			let file = files[3];
			console.log("Parsing " + file.path);

			//files.forEach(file => {
				vscode.workspace.openTextDocument(file).then(
					doc => {
						let ast = luaparse.parse(doc.getText(), {
							locations: true
						});

						if(ast.type !== "Chunk") {
							console.log("Root node is not a chunk!");
							return;
						}

						let data = {
							globalVariables: [],
							globalFunctions: [],
							globalMembers: [],
							metaTables: {GM: "GM"},
							hooks: {},
						};

						parseBody(ast, data);

						data.globalFunctions.forEach((func: any) => {
							let params = func.parameters.join(', ');
							console.log(`line ${func.line}: ${func.name}(${params})`);
						});

						data.globalMembers.forEach((memb: any) => {
							let tbl = memb.metaTable || memb.table;

							if(memb.type === "function"){
								let params = memb.parameters.join(', ');
								console.log(`line ${memb.line}: ${tbl}:${memb.name}(${params})`);
							}
							else{
								console.log(`line ${memb.line}: ${tbl}.${memb.name}`);
							}
						});
						
						console.log(ast);
						console.log(data);
					}
				);
			//});
		}
	)

	/*
	let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {
		vscode.window.showInformationMessage('Hello VS Code!');
	});
	context.subscriptions.push(disposable);
	*/

}

// this method is called when your extension is deactivated
export function deactivate() {}
