/**
 * Plugin System Errors
 */

export class PluginError extends Error {
  constructor(
    message: string,
    public readonly pluginName?: string,
    public readonly code?: string,
  ) {
    super(pluginName ? `[${pluginName}] ${message}` : message);
    this.name = 'PluginError';
  }
}

export class PluginLoadError extends PluginError {
  constructor(pluginName: string, reason: string) {
    super(`Failed to load: ${reason}`, pluginName, 'PLUGIN_LOAD_ERROR');
    this.name = 'PluginLoadError';
  }
}

export class PluginManifestError extends PluginError {
  constructor(pluginName: string, reason: string) {
    super(`Invalid manifest: ${reason}`, pluginName, 'PLUGIN_MANIFEST_ERROR');
    this.name = 'PluginManifestError';
  }
}

export class PluginActivationError extends PluginError {
  constructor(pluginName: string, reason: string) {
    super(`Activation failed: ${reason}`, pluginName, 'PLUGIN_ACTIVATION_ERROR');
    this.name = 'PluginActivationError';
  }
}

export class PluginNotFoundError extends PluginError {
  constructor(pluginName: string) {
    super(`Plugin not found`, pluginName, 'PLUGIN_NOT_FOUND');
    this.name = 'PluginNotFoundError';
  }
}

export class PluginDuplicateError extends PluginError {
  constructor(pluginName: string) {
    super(`Plugin already registered`, pluginName, 'PLUGIN_DUPLICATE');
    this.name = 'PluginDuplicateError';
  }
}
