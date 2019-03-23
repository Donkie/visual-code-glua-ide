
import * as vscode from 'vscode';
import { LuaPrimitive } from './Parser/GlobalData';
import { LuaParser } from "./Parser/LuaParser";


export function activate(context: vscode.ExtensionContext) {
	console.log("visual-code-glua-ide is now active!");

	vscode.workspace.findFiles('**/*.lua').then(
		files => {
			let file = files[31];
			console.log("Parsing " + file.path);

			//files.forEach(file => {
				vscode.workspace.openTextDocument(file).then(
					doc => {

						let parser = new LuaParser(file.path);
						parser.parseLua(doc.getText());

						let data = parser.data;

						console.log("Hooks:");
						data.hooks.forEach(hook => {
							let params = hook.parameters.join(', ');
							console.log(`line ${hook.line}: ${hook.name}(${params})`);
						});
						
						console.log("Global Variables:");
						data.variables.forEach(variable => {
							console.log(`line ${variable.line}: ${variable.name} (type '${LuaPrimitive[variable.type]}')`);
						});

						console.log("Global Functions:");
						data.functions.forEach(func => {
							let params = func.parameters.join(', ');
							console.log(`line ${func.line}: ${func.name}(${params})`);
						});

						console.log("Member Functions:");
						data.memberFunctions.forEach(memb => {
							let tbl = memb.table;
							let params = memb.f.parameters.join(', ');
							console.log(`line ${memb.f.line}: ${tbl}${memb.indexer}${memb.f.name}(${params})`);
						});

						console.log("Member Variables:");
						data.memberVariables.forEach(memb => {
							let tbl = memb.table;

							console.log(`line ${memb.v.line}: ${tbl}.${memb.v.name} (type '${LuaPrimitive[memb.v.type]}')`);
						});
						
						//console.log(ast);
						//console.log(data);
					}
				);
			//});
		}
	);

	/*
	/*
	let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {
		vscode.window.showInformationMessage('Hello VS Code!');
	});
	context.subscriptions.push(disposable);
	*/

}

// this method is called when your extension is deactivated
export function deactivate() {}
