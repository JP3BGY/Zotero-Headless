#!/usr/bin/env bash
# Zotero CLI Bash Completion

_zotero_completion() {
  local cur prev words cword
  _init_completion || return

  # Main commands
  local commands="sync list search get stats verify add add-by-id update delete export note attachments attachment-download attachment-open attachment-dedup help"

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
    note)
      local note_cmds="add edit show list export"
      COMPREPLY=($(compgen -W "$note_cmds" -- "$cur"))
      ;;
    attachment-download|attachment-open)
      # Placeholder for key completion
      COMPREPLY=()
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
