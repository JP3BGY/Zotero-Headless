#!/bin/bash
# Zotero CLI Bash Completion Script
# Installation: source this file in your ~/.bashrc or ~/.bash_profile

_zotero_complete() {
    local cur prev words cword
    _init_completion || return

    # Main commands
    local commands="sync list search get stats verify add add-by-id update delete export note attachments attachment-download attachment-open attachment-dedup config history help"

    # Get the command (first non-option argument)
    local cmd=""
    local i=1
    while [ $i -lt $cword ]; do
        if [[ ${words[i]} != -* ]]; then
            cmd=${words[i]}
            break
        fi
        ((i++))
    done

    # Complete main commands
    if [ -z "$cmd" ]; then
        COMPREPLY=($(compgen -W "$commands" -- "$cur"))
        return
    fi

    # Command-specific completions
    case "$cmd" in
        get|show|cat|view|update|delete|rm)
            # Complete with recent item keys from history
            if [ -f ~/.local/share/zotero-headless/history.json ]; then
                local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                COMPREPLY=($(compgen -W "$keys" -- "$cur"))
            fi
            ;;
        
        note)
            if [ $cword -eq 2 ]; then
                COMPREPLY=($(compgen -W "add edit show list export" -- "$cur"))
            elif [ "${words[2]}" = "edit" ] || [ "${words[2]}" = "show" ]; then
                # Complete with note keys
                if [ -f ~/.local/share/zotero-headless/history.json ]; then
                    local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                    COMPREPLY=($(compgen -W "$keys" -- "$cur"))
                fi
            fi
            ;;
        
        attachment-download|attachment-open|attdl|atto)
            # Complete with attachment keys
            if [ -f ~/.local/share/zotero-headless/history.json ]; then
                local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                COMPREPLY=($(compgen -W "$keys" -- "$cur"))
            fi
            ;;
        
        list|ls)
            COMPREPLY=($(compgen -W "--type --unsynced --deleted --since --until --sort --order --limit --offset -t -u -d -s -e -l" -- "$cur"))
            ;;
        
        search|find|grep)
            COMPREPLY=($(compgen -W "--field --since --unsynced --limit -f -s -u -l" -- "$cur"))
            ;;
        
        config|cfg)
            COMPREPLY=($(compgen -W "--init --show --editor --language" -- "$cur"))
            ;;
        
        history|hist)
            COMPREPLY=($(compgen -W "--clear" -- "$cur"))
            ;;
        
        *)
            COMPREPLY=()
            ;;
    esac
}

# Register completion
complete -F _zotero_complete zotero
