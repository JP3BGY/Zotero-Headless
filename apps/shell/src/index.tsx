#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { ZoteroShell } from './app.js';

render(<ZoteroShell />, { exitOnCtrlC: false });
