// @ts-nocheck

export interface CommandOption {
  name: string;
  alias?: string;
  description: string;
  value?: string; // value placeholder like "<type>", "<N>"
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  options?: CommandOption[];
  examples?: string[];
  execute: (args: string[], invokedAs?: string) => Promise<void>;
}

// Shell mode flag — when true, permanent delete is allowed
let _shellMode = false;
export function setShellMode(v: boolean) { _shellMode = v; }
export function isShellMode(): boolean { return _shellMode; }
