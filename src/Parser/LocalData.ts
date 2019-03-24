

class LuaScope{
	/** Keeps track of local variables, function parameters will appear here aswell */
	private locals: {[name: string]: boolean};

	/** Keeps track of function parameters */
	private parameters: {[name: string]: boolean};

	/** Maps a local variable name to a metatable name, e.g. "plymeta => Player" */
	private metaTables: {[varName: string]: string};

	/** Children scopes of this scope */
	private childScopes: LuaScope[];

	/** Line number of the start of the scope */
	private scopeStart: number;

	/** Line number of the end of the scope */
	private scopeEnd: number;

	/** Add a local variable to the scope */
	public addLocal(name: string){
		this.locals[name] = true;
	}

	/** Add a function parameter to the scope */
	public addParameter(name: string){
		this.parameters[name] = true;
	}

	/** Add a meta table mapping to the scope, e.g. "plymeta => Player" */
	public addMetaTable(varName: string, metaName: string){
		this.metaTables[varName] = metaName;
	}

	/** Add the special keyword "self" to the scope */
	public addSelf(){
		this.locals["self"] = true;
		this.parameters["self"] = true;
	}

	/** Does this scope have a meta table mapping defined for varName? */
	public hasMetaTable(varName: string): boolean{
		return this.metaTables[varName] !== undefined;
	}

	/** Is this variable a local in the scope? */
	public hasLocal(name: string): boolean{
		return this.locals[name] !== undefined;
	}

	/** Performs some additional checks whether to consider this variable a local or not */
	public isLocal(name: string): boolean{
		if(this.hasMetaTable(name)){
			return false;
		}

		if(this.hasLocal(name)){
			return true;
		}

		return false;
	}

	/** Translates a meta table mapping, e.g. "plymeta => Player" */
	public translateMetaTable(varName: string): string{
		return this.metaTables[varName];
	}

	/**
	 * @param parentScope Scope to deep-copy from
	 */
	constructor(scopeStart: number, scopeEnd: number, parentScope?: LuaScope){
		if(parentScope){
			this.locals = Object.assign({}, parentScope.locals);
			this.parameters = Object.assign({}, parentScope.parameters);
			this.metaTables = Object.assign({}, parentScope.metaTables);

			parentScope.childScopes.push(this);
		}
		else{
			this.locals = {};
			this.parameters = {};
			this.metaTables = {};
		}

		this.scopeStart = scopeStart;
		this.scopeEnd = scopeEnd;
		this.childScopes = [];
	}
}

export {LuaScope};
