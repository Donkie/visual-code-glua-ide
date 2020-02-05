
enum LuaPrimitive{
	nil,
	boolean,
	number,
	string,
	function,
	userdata,
	thread,
	table,
	any // not really an official primitive
}

/** Represents a variable definition */
class LuaVariable {
	/**
	 * @param type The type of the value assigned to the variable, this is not very reliable but can sometimes be useful
	 * @param name The variable name
	 * @param line The line the variable is defined on
	 * @param fileid The file identifier which the variable is defined in
	 */
	constructor(
		readonly type: LuaPrimitive,
		readonly name: string,
		readonly line: number,
		readonly fileid: string
	){}
}

/** Represents a variable definition on a table */
class LuaMemberVariable {
	/**
	 * @param isMeta Is the table a metatable (assigned using FindMetaTable()) or just a regular table?
	 * @param table The table it's assigned to. If isMeta, this should be for example "Player" or "Entity"
	 * @param v The variable info
	 */
	constructor(
		readonly isMeta: boolean,
		readonly table: string,
		readonly v: LuaVariable
	){}
}

/** Represents a function definition */
class LuaFunction {
	/**
	 * @param name The name of the function
	 * @param parameters An array of parameter names for the function
	 * @param line The line the function is defined on
	 * @param fileid The file identifier which the function is defined in
	 */
	constructor(
		readonly name: string,
		readonly parameters: string[],
		readonly line: number,
		readonly fileid: string
	){}
}

/** Represents a function definition on a table */
class LuaMemberFunction {
	/**
	 * @param isMeta Is the table a metatable (assigned using FindMetaTable()) or just a regular table?
	 * @param table The table it's assigned to. If isMeta, this should be for example "Player" or "Entity"
	 * @param indexer The indexer used to define the function on the table, either . or :
	 * @param f The function info
	 */
	constructor(
		readonly isMeta: boolean,
		readonly table: string,
		readonly indexer: string,
		readonly f: LuaFunction
	){}
}

/** Represents a Garry's Mod Hook */
class LuaHook {
	/**
	 * @param name The name of the hook
	 * @param parameters The parameters supplied by the hook
	 * @param line The line the hook is defined on
	 * @param fileid The file identifier which the hook is defined in
	 */
	constructor(
		readonly name: string,
		readonly parameters: string[],
		readonly line: number,
		readonly fileid: string
	){}
}

/** Represents a set of lua variables, functions, etc that are useful to know about outside any specific file */
class GlobalData {
	readonly variables: LuaVariable[] = [];
	readonly functions: LuaFunction[] = [];
	readonly memberVariables: LuaMemberVariable[] = [];
	readonly memberFunctions: LuaMemberFunction[] = [];
	readonly hooks: LuaHook[] = [];
}

export {LuaPrimitive, LuaFunction, LuaVariable, LuaMemberFunction, LuaMemberVariable, LuaHook, GlobalData};
