/** Key/Value store backed by localStorage */
class Logger {
    constructor({settingsStore}) {
        this.settingsStore = settingsStore;
        this.verboseMode = false;
        this.debugMode = false;
    }

    init({verboseMode, debugMode}) {
        this.verboseMode = verboseMode;
        this.debugMode = debugMode;
    }

    debug(...args) {

        if (this.debugMode) {
            console.log('[DEBUG]', ...args);
        }
    };

    verbose(...args) {

        if (this.verboseMode) {
            console.log('[VERBOSE]', ...args);
        }
    };
}