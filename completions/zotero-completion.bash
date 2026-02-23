#!/bin/bash
# Zotero CLI Bash Completion Script
# Installation: source this file in your ~/.bashrc or ~/.bash_profile

_zotero_complete() {
    local cur prev words cword
    _init_completion || return

    # Main commands
    local commands="sync list search get stats verify add add-by-id update delete export note attachments attachment-download attachment-open attachment-dedup config history help shell"

    # Get the command (first non-option argument)
    local cmd=""
    local cmd_index=0
    local i=1
    while [ $i -lt $cword ]; do
        if [[ ${words[i]} != -* ]]; then
            cmd=${words[i]}
            cmd_index=$i
            break
        fi
        ((i++))
    done

    # Complete main commands
    if [ -z "$cmd" ]; then
        COMPREPLY=($(compgen -W "$commands" -- "$cur"))
        return
    fi

    # If current word starts with -, complete options
    if [[ $cur == -* ]]; then
        case "$cmd" in
            sync|s|pull|fetch)
                COMPREPLY=($(compgen -W "--full-sync --groups --group --quiet --interactive -f -g -G -q -i" -- "$cur"))
                ;;
            list|ls|ll|la)
                COMPREPLY=($(compgen -W "--type --unsynced --deleted --since --until --sort --order --limit --offset --compact -t -u -d -s -e -l -o -c" -- "$cur"))
                ;;
            search|find|grep|f)
                COMPREPLY=($(compgen -W "--field --since --unsynced --limit -f -s -u -l" -- "$cur"))
                ;;
            add|a|new|touch)
                # add command takes type and title as positional args
                COMPREPLY=($(compgen -W "--attachment -a" -- "$cur"))
                ;;
            add-by-id|addby)
                COMPREPLY=($(compgen -W "--attachment -a" -- "$cur"))
                ;;
            delete|rm|del|trash)
                COMPREPLY=($(compgen -W "--permanent --force -p -f" -- "$cur"))
                ;;
            export|e|out|save)
                COMPREPLY=($(compgen -W "--format --limit -f -l" -- "$cur"))
                ;;
            config|cfg)
                COMPREPLY=($(compgen -W "--init --show" -- "$cur"))
                ;;
            history|hist)
                COMPREPLY=($(compgen -W "--clear" -- "$cur"))
                ;;
            groups|g)
                COMPREPLY=($(compgen -W "--sync" -- "$cur"))
                ;;
            webdav|wd)
                COMPREPLY=($(compgen -W "config sync status scan" -- "$cur"))
                ;;
            attachment-dedup|attdedup|dedup)
                COMPREPLY=($(compgen -W "--delete" -- "$cur"))
                ;;
            *)
                COMPREPLY=()
                ;;
        esac
        return
    fi

    # Command-specific completions for positional arguments
    case "$cmd" in
        get|show|cat|view|update|u|edit|set|delete|rm|del|trash)
            # Complete with recent item keys from history
            if [ -f ~/.local/share/zotero-headless/history.json ]; then
                local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                COMPREPLY=($(compgen -W "$keys" -- "$cur"))
            fi
            ;;
        
        note|n|notes)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "add edit show list export" -- "$cur"))
            elif [ "$prev" = "edit" ] || [ "$prev" = "show" ] || [ "$prev" = "list" ] || [ "$prev" = "export" ]; then
                # Complete with note keys
                if [ -f ~/.local/share/zotero-headless/history.json ]; then
                    local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                    COMPREPLY=($(compgen -W "$keys" -- "$cur"))
                fi
            fi
            ;;
        
        attachment-download|attachment-open|attdl|atto|down|open)
            # Complete with attachment keys
            if [ -f ~/.local/share/zotero-headless/history.json ]; then
                local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                COMPREPLY=($(compgen -W "$keys" -- "$cur"))
            fi
            ;;

        help|h|?)
            # Complete with available commands
            COMPREPLY=($(compgen -W "$commands" -- "$cur"))
            ;;

        groups|g)
            if [ "$prev" = "--sync" ]; then
                # Could complete with group IDs if we had them cached
                COMPREPLY=()
            fi
            ;;
        
        *)
            COMPREPLY=()
            ;;
    esac
}

# Register completion
complete -F _zotero_complete zotero
