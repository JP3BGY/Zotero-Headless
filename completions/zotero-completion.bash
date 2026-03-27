#!/bin/bash
# Zotero CLI Bash Completion Script
# Installation: source this file in your ~/.bashrc or ~/.bash_profile

_zotero_complete() {
    local cur prev words cword
    _init_completion || return

    # Main commands
    local commands="sync list search get stats verify add update delete export note attachment trash webdav config history help shell groups collections tags batch cite creators duplicates related searches annotations"

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
                COMPREPLY=($(compgen -W "--attachment -a" -- "$cur"))
                ;;
            delete|rm|del)
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
            trash)
                COMPREPLY=($(compgen -W "--count --all --yes --dry-run -c -a -y -n" -- "$cur"))
                ;;
            attachment|att|files)
                COMPREPLY=($(compgen -W "--item --limit --force --wait --delete --dry-run -l -f -w -d" -- "$cur"))
                ;;
            webdav|wd)
                COMPREPLY=($(compgen -W "--auto-sync --base-path --download --upload --verbose --orphaned -d -u -v -o" -- "$cur"))
                ;;
            *)
                COMPREPLY=()
                ;;
        esac
        return
    fi

    # Command-specific completions for positional arguments
    case "$cmd" in
        get|show|cat|view|update|u|edit|set|delete|rm|del)
            # Complete with recent item keys from history
            if [ -f ~/.local/share/zotero-headless/history.json ]; then
                local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                COMPREPLY=($(compgen -W "$keys" -- "$cur"))
            fi
            ;;

        sync|s|pull|fetch)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "upload" -- "$cur"))
            fi
            ;;

        list|ls|ll|la)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "unsynced" -- "$cur"))
            fi
            ;;

        add|a|new|touch)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "byid journalArticle book bookSection conferencePaper thesis report webpage document" -- "$cur"))
            fi
            ;;

        trash)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "list empty restore" -- "$cur"))
            elif [ "$prev" = "restore" ]; then
                if [ -f ~/.local/share/zotero-headless/history.json ]; then
                    local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                    COMPREPLY=($(compgen -W "$keys --all" -- "$cur"))
                fi
            fi
            ;;

        webdav|wd)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "config sync status scan" -- "$cur"))
            fi
            ;;

        attachment|att|files)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "list download open dedup" -- "$cur"))
            elif [ "$prev" = "download" ] || [ "$prev" = "open" ]; then
                if [ -f ~/.local/share/zotero-headless/history.json ]; then
                    local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                    COMPREPLY=($(compgen -W "$keys" -- "$cur"))
                fi
            fi
            ;;

        note|n|notes)
            if [ $((cword - cmd_index)) -eq 1 ]; then
                COMPREPLY=($(compgen -W "add edit show list export" -- "$cur"))
            elif [ "$prev" = "edit" ] || [ "$prev" = "show" ] || [ "$prev" = "list" ] || [ "$prev" = "export" ]; then
                if [ -f ~/.local/share/zotero-headless/history.json ]; then
                    local keys=$(cat ~/.local/share/zotero-headless/history.json 2>/dev/null | grep -o '"key":"[^"]*"' | cut -d'"' -f4 | head -20)
                    COMPREPLY=($(compgen -W "$keys" -- "$cur"))
                fi
            fi
            ;;

        help|h|?)
            # Complete with available commands
            COMPREPLY=($(compgen -W "$commands" -- "$cur"))
            ;;

        *)
            COMPREPLY=()
            ;;
    esac
}

# Register completion
complete -F _zotero_complete zotero
