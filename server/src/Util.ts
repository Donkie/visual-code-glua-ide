import { exec } from 'child_process';
import G = require('glob');
import fs = require('fs');

abstract class Util {
	public static glob(globstr: string): Promise<string[]>{
		return new Promise<string[]>((resolve, reject) => {
			G(globstr, (err, files) => {
				if(err){
					reject(err);
				}
				resolve(files);
			});
		});
	}

	public static readFile(file: string): Promise<string>{
		return new Promise<string>((resolve, reject) => {
			fs.readFile(file, 'utf8', function(err, data) {
				if (err) {
					reject(err);
				}
				resolve(data);
			});
		});
	}

	public static execShellCommand(cmd: string, stdin?: string): Promise<string>{
		return new Promise<string>((resolve, reject) => {
			let cp = exec(cmd, (error, stdout, stderr) => {
				resolve(stderr + '\n' + stdout);
			});

			if(stdin !== null && cp.stdin !== null){
				cp.stdin.write(stdin);
				cp.stdin.end();
			}
		});
	}
}

export {Util};

