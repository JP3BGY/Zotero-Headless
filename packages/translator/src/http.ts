// @ts-nocheck

// Node.js implementation of Zotero.HTTP using fetch().
// Returns XHR-like response objects that the framework expects.

/**
 * Install Node.js HTTP implementation onto the Zotero object.
 */
export function installNodeHttp(Zotero: any): void {
  const HTTP: any = {};

  HTTP.StatusError = function (xhr: any, url: string) {
    this.message = `HTTP request to ${url} rejected with status ${xhr.status}`;
    this.status = xhr.status;
    this.responseText = xhr.responseText;
  };
  HTTP.StatusError.prototype = Object.create(Error.prototype);

  HTTP.TimeoutError = function (ms: number) {
    this.message = `HTTP request has timed out after ${ms}ms`;
  };
  HTTP.TimeoutError.prototype = Object.create(Error.prototype);

  HTTP.request = async function (method: string, url: string, options: any = {}) {
    options = Object.assign({
      body: null,
      headers: {},
      timeout: 15000,
      responseType: '',
      successCodes: null,
    }, options);

    if (['GET', 'HEAD'].includes(method) && options.body != null) {
      throw new Error(`HTTP ${method} cannot have a request body`);
    }

    if (options.body && typeof options.body !== 'string') {
      options.body = JSON.stringify(options.body);
    }

    if (options.body && !options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    Zotero.debug(`HTTP ${method} ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const fetchOptions: any = {
        method,
        headers: options.headers,
        signal: controller.signal,
        redirect: 'follow',
      };
      if (options.body) {
        fetchOptions.body = options.body;
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const text = await response.text();

      // Build XHR-like response object
      const xhr: any = {
        status: response.status,
        statusText: response.statusText,
        responseText: text,
        responseURL: response.url,
        response: text, // set below after status check for JSON
        getResponseHeader: (h: string) => response.headers.get(h),
        getAllResponseHeaders: () => {
          const result: string[] = [];
          response.headers.forEach((v: string, k: string) => result.push(`${k}: ${v}`));
          return result.join('\r\n');
        },
      };

      // Check status codes before attempting JSON parse
      const invalidDefault = options.successCodes === null
        && (xhr.status < 200 || xhr.status >= 300);
      const invalidCustom = Array.isArray(options.successCodes)
        && !options.successCodes.includes(xhr.status);

      if (invalidDefault || invalidCustom) {
        throw new HTTP.StatusError(xhr, url);
      }

      if (options.responseType === 'json') {
        xhr.response = JSON.parse(text);
      }

      return xhr;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new HTTP.TimeoutError(options.timeout);
      }
      throw err;
    }
  };

  // Deprecated methods — delegate to request()
  HTTP.doGet = function (url: string, onDone: any, responseCharset?: string, _cookieSandbox?: any, headers?: any) {
    HTTP.request('GET', url, { responseCharset, headers })
      .then(onDone, (e: any) => {
        onDone({ status: e.status, responseText: e.responseText });
      });
    return true;
  };

  HTTP.doPost = function (url: string, body: any, onDone: any, headers?: any, responseCharset?: string) {
    HTTP.request('POST', url, { body, responseCharset, headers })
      .then(onDone, (e: any) => {
        onDone({ status: e.status, responseText: e.responseText });
      });
    return true;
  };

  HTTP.processDocuments = async function () {
    throw new Error('Zotero.HTTP.processDocuments not implemented (Web translation not supported)');
  };

  Zotero.HTTP = HTTP;
}
