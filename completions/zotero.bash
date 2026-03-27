#!/usr/bin/env bash
# Zotero CLI Bash Completion

_zotero_completion() {
  local cur prev words cword
  _init_completion || return

  # Main commands
  local commands="sync list search get stats verify add update delete export note attachment trash webdav config history help shell groups collections tags batch cite creators duplicates related searches annotations"

  # First argument - main commands
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  # Second argument - command-specific
  local cmd="${words[1]}"

  case "$cmd" in
    show|cat|view)
      # Would need to query database for recent keys - use placeholder
      COMPREPLY=()
      ;;
    sync|s)
      COMPREPLY=($(compgen -W "upload" -- "$cur"))
      ;;
    list|ls)
      COMPREPLY=($(compgen -W "unsynced" -- "$cur"))
      ;;
    add|a)
      COMPREPLY=($(compgen -W "byid journalArticle book bookSection conferencePaper thesis report webpage document" -- "$cur"))
      ;;
    trash)
      COMPREPLY=($(compgen -W "list empty restore" -- "$cur"))
      ;;
    webdav|wd)
      COMPREPLY=($(compgen -W "config sync status scan" -- "$cur"))
      ;;
    attachment|att|files)
      COMPREPLY=($(compgen -W "list download open dedup" -- "$cur"))
      ;;
    note|n)
      local note_cmds="add edit show list export"
      COMPREPLY=($(compgen -W "$note_cmds" -- "$cur"))
      ;;
    help|h)
      COMPREPLY=($(compgen -W "$commands" -- "$cur"))
      ;;
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _zotero_completion zotero
