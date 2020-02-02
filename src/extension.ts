
import * as vscode from 'vscode';
import { LuaPrimitive } from './Parser/GlobalData';
import { LuaParser } from "./Parser/LuaParser";
import * as rp from "request-promise";
import * as he from "he";

function getFileId(path: string){
	const regex = /steamapps\/common\/garrysmod\/garrysmod\/(.+)$/i;
	let groups = regex.exec(path);
	if(groups === null){ // not a gmod path, do more advanced logic here later
		return path;
	}

	return groups[1];
}

async function readAndParse(parser: LuaParser, file: vscode.Uri){
	let fileId = getFileId(file.path);

	console.log("Parsing " + fileId);
	
	let doc = await vscode.workspace.openTextDocument(file);
	parser.setFileId(fileId);
	parser.parseLua(doc.getText());
}

async function parseFiles(parser: LuaParser, files: vscode.Uri[]){
	for(let i = 0; i < files.length; i++){
		await readAndParse(parser, files[i]);
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log("visual-code-glua-ide is now active!");

	//vscode.workspace.findFiles('**/*.lua').then(
	vscode.workspace.findFiles('gamemode/*.lua').then(
		files => {
			let parser = new LuaParser();

			parseFiles(parser, files).then(
				() => {
					let data = parser.data;
		
					console.log("File scope tree: ", parser.topScope);
		
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
				}
			);
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

function matchOnce(str: string, regex: RegExp){
	let m;
	if ((m = regex.exec(str)) !== null) {
		
		// The result can be accessed through the `m`-variable.
		m.forEach((match, groupIndex) => {
			console.log(`Found match, group ${groupIndex}: ${match}`);
		});
	}
}

vscode.languages.registerHoverProvider("glua", {
	provideHover(document, position, token) {
		console.log(document.uri.toString());
		console.log(position);
		console.log(token);
		const range = document.getWordRangeAtPosition(position, /\w[\w\.\:]*/);
		const word = document.getText(range);

		const regex = /<function[\W\w]+(?:<description>([\w\W]+?)<\/description>)[\W\w]+(?:<realm>(.+)<\/realm>)[\W\w]+\/function>/;
		
		return rp.get(`https://wiki.facepunch.com/gmod/${word}?format=json`)
			.then(json => {
				const data = JSON.parse(json);
				const markup = he.decode(data.markup);
				const m = regex.exec(markup);
				if(m === null){
					console.log(data);
					return null;
				}
				console.log(m![1]);

				return new vscode.Hover(
					m![1],
					range
				);
			});
	}
});

// this method is called when your extension is deactivated
export function deactivate() {}
