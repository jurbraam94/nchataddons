(async function () {
    class ExampleClass {
        constructor(appInstance) {
            if (!appInstance) {
                console.error('[ChatAddonTester] Missing app instance');
            }
            this.app = appInstance;
        }

        async init() {
            
        }

        async classMethod() {
            console.log('test function')
        }
    }

    const exampleClass = new ExampleClass();
    window.exampleClass = exampleClass;
    await exampleClass.init();
})();
