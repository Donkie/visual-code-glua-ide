import { TextDocuments, TextDocument, Connection, ClientCapabilities, Diagnostic, DiagnosticSeverity, Range, NotificationType0, PublishDiagnosticsNotification, InitializeParams, DocumentFilter } from 'vscode-languageserver';
import { Util } from './Util';

class Linter {
	connection: Connection;
	documents: TextDocuments;
	
	constructor(connection: Connection, documents: TextDocuments) {
		this.connection = connection;
		this.documents = documents;

		documents.onDidChangeContent(change => {
			this.validateDocument(change.document);
		});
	}

	public async initialize(params: InitializeParams) {
		let files: string[];
		try {
			files = await Util.glob(params.rootPath + "\\**\\*.lua");
		} catch(e) {
			console.log("Couldn't glob path: " + e);
			return;
		}

		for (let i = 0; i < files.length; i++){
			const file = files[i];

			Util.readFile(file)
				.then(contents => {
					const doc = TextDocument.create("file:///" + file, 'glua', 1, contents);
					this.validateDocument(doc);
				})
				.catch(err => {
					console.log("Failed reading file: " + err);
				});
		}
	}

	public capabilities(clientCapabilities: ClientCapabilities): any{
	}

	private async parse(textDocument: TextDocument): Promise<Diagnostic | null>{
		const stdout = await Util.execShellCommand(`gluac -p -`, textDocument.getText());
		let m;
		if((m = /^error:.+?:(\d+):\s(.+)$/m.exec(stdout)) !== null){
			const line = parseInt(m[1]);
			const err = m[2];

			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: Range.create(line, 0, line, Number.MAX_VALUE),
				message: err,
				source: '[glua-ls gluac]'
			};
			return diagnostic;
		}
		return null;
	}

	private async lint(textDocument: TextDocument): Promise<Diagnostic[]>{
		const stdout = await Util.execShellCommand(`glualint --stdin`, textDocument.getText());
		const diagnostics: Diagnostic[] = [];
		const regex = /\[Warning\] line (\d+), column (\d+) - line (\d+), column (\d+): (.+)$/gm;

		let m;
		while ((m = regex.exec(stdout)) !== null) {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				range: Range.create(parseInt(m[1]) - 1, parseInt(m[2]) - 1, parseInt(m[3]) - 1, parseInt(m[4]) - 1),
				message: m[5],
				source: '[glua-ls glualint]'
			};
			diagnostics.push(diagnostic);
		}

		return diagnostics;
	}

	private async validateDocument(textDocument: TextDocument){
		console.log("Validating " + textDocument.uri);
		let diagnostics: Diagnostic[] = [];

		let err = await this.parse(textDocument);
		if(err !== null){
			diagnostics.push(err);
		}
		else {
			let errs = await this.lint(textDocument);
			errs.forEach((diag) => diagnostics.push(diag));
		}

		console.log(`Sending ${diagnostics.length} diagnostics`);

		this.connection.sendNotification(PublishDiagnosticsNotification.type,
			{
				uri: textDocument.uri,
				diagnostics
			}
		);
	}
}

export {Linter};
