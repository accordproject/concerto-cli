/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const c = require('ansi-colors');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const RandExp = require('randexp');

const Logger = require('@accordproject/concerto-util').Logger;
const FileWriter = require('@accordproject/concerto-util').FileWriter;

const MetaModelUtil = require('@accordproject/concerto-metamodel').MetaModelUtil;

const Printer = require('@accordproject/concerto-cto').Printer;
const Parser = require('@accordproject/concerto-cto').Parser;
const External = require('@accordproject/concerto-cto').External;

const ModelLoader = require('@accordproject/concerto-core').ModelLoader;
const Factory = require('@accordproject/concerto-core').Factory;
const Serializer = require('@accordproject/concerto-core').Serializer;
const Concerto = require('@accordproject/concerto-core').Concerto;
const CodeGen = require('@accordproject/concerto-codegen').CodeGen;

const { Compare, compareResultToString } = require('@accordproject/concerto-analysis');
const { ModelFile, ModelManager,DecoratorManager } = require('@accordproject/concerto-core');
const { VocabularyManager } = require('@accordproject/concerto-vocabulary');

/**
 * Utility class that implements the commands exposed by the CLI.
 * @class
 * @memberof module:concerto-cli
 */
class Commands {
    /**
     * Set a default for a file argument
     *
     * @param {object} argv - the inbound argument values object
     * @param {string} argName - the argument name
     * @param {string} argDefaultName - the argument default name
     * @param {Function} argDefaultFun - how to compute the argument default
     * @param {object} argDefaultValue - an optional default value if all else fails
     * @returns {object} a modified argument object
     */
    static setDefaultFileArg(argv, argName, argDefaultName, argDefaultFun) {
        if(!argv[argName]){
            Logger.info(`Loading a default ${argDefaultName} file.`);
            argv[argName] = argDefaultFun(argv, argDefaultName);
        }

        let argExists = true;
        if (Array.isArray(argv[argName])) {
            // All files should exist
            for (let i = 0; i < argv[argName].length; i++) {
                if (fs.existsSync(argv[argName][i]) && argExists) {
                    argExists = true;
                } else {
                    argExists = false;
                }
            }
        } else {
            // This file should exist
            argExists = fs.existsSync(argv[argName]);
        }

        if (!argExists){
            throw new Error(`A ${argDefaultName} file is required. Try the --${argName} flag or create a ${argDefaultName} file.`);
        } else {
            return argv;
        }
    }

    /**
     * Set default params before we parse a sample text using a template
     *
     * @param {object} argv - the inbound argument values object
     * @returns {object} a modfied argument object
     */
    static validateValidateArgs(argv) {
        argv = Commands.setDefaultFileArg(argv, 'input', 'input.json', ((argv, argDefaultName) => { return path.resolve('.',argDefaultName); }));
        argv = Commands.setDefaultFileArg(argv, 'model', 'model.cto', ((argv, argDefaultName) => { return [path.resolve('.',argDefaultName)]; }));

        if(argv.verbose) {
            Logger.info(`validate ${argv.input} using a model ${argv.model}`);
        }

        return argv;
    }

    /**
     * Validate a sample JSON against the model
     *
     * @param {string} sample - the sample to validate
     * @param {string[]} ctoFiles - the CTO files to convert to code
     * @param {object} options - optional parameters
     * @param {boolean} [options.offline] - do not resolve external models
     * @returns {string} serialized form of the validated JSON
     */
    static async validate(sample, ctoFiles, options) {
        const json = JSON.parse(fs.readFileSync(sample, 'utf8'));

        const modelManager = await ModelLoader.loadModelManager(ctoFiles, options);

        if (options.functional) {
            const concerto = new Concerto(modelManager);

            concerto.validate(json);
        } else {
            const factory = new Factory(modelManager);
            const serializer = new Serializer(factory, modelManager);

            const object = serializer.fromJSON(json, options);
            return JSON.stringify(serializer.toJSON(object, options));
        }
    }

    /**
     * Compile the model for a given target
     *
     * @param {string} target - the target of the code to compile
     * @param {string[]} ctoFiles - the CTO files to convert to code
     * @param {string} output the output directory
     * @param {object} options - optional parameters
     * @param {boolean} [options.offline] - do not resolve external models
     * @param {boolean} [options.strict] - require versioned namespaces and imports
     * @param {boolean} [options.metamodel] - include the Concerto Metamodel
     * @param {boolean} [options.useSystemTextJson] - compile for System.Text.Json library
     * @param {boolean} [options.useNewtonsoftJson] - compile for Newtonsoft.Json library
     * @param {boolean} [options.enableReferenceType] - enable resolving referential id
     * @param {boolean} [options.pascalCase] - use PascalCase in generated names
     */
    static async compile(target, ctoFiles, output, options) {
        const modelManagerOptions = { offline: options && options.offline, strict: options && options.strict };
        const visitorOptions = {
            useSystemTextJson: options && options.useSystemTextJson,
            useNewtonsoftJson: options && options.useNewtonsoftJson,
            namespacePrefix: options && options.namespacePrefix,
            enableReferenceType: options && options.enableReferenceType,
            pascalCase: options && options.pascalCase,
            hideBaseModel: options && options.hideBaseModel,
            showCompositionRelationships: options && options.showCompositionRelationships,
        };

        const modelManager = await ModelLoader.loadModelManager(ctoFiles, modelManagerOptions);
        if (options && options.metamodel) {
            modelManager.addCTOModel(MetaModelUtil.metaModelCto);
        }

        const visitorClass = CodeGen.formats[target.toLowerCase()];
        if(visitorClass) {
            const visitor = new visitorClass;
            let parameters = visitorOptions;
            parameters.fileWriter = new FileWriter(output);
            modelManager.accept(visitor, parameters);
            return `Compiled to ${target} in '${output}'.`;
        }
        else {
            return `Unrecognized target: ${target}. Supported targets are: ${Object.keys(CodeGen.formats)}`;
        }
    }

    /**
     * Fetches all external for a set of models dependencies and
     * saves all the models to a target directory
     *
     * @param {string[]} ctoFiles the CTO files (can be local file paths or URLs)
     * @param {string} output the output directory
     */
    static async get(ctoFiles, output) {
        const modelManager = await ModelLoader.loadModelManager(ctoFiles);
        fs.mkdirSync(path.dirname(output), {recursive:true});
        modelManager.writeModelsToFileSystem(output);
        return `Loaded external models in '${output}'.`;
    }

    /**
     * Parse a cto string to a JSON syntax tree
     *
     * @param {string[]} [ctoFiles] - the CTO files used for import resolution
     * @param {boolean} resolve - whether to resolve the names
     * @param {boolean} all - whether to import all models
     * @param {string} outputPath to an output file
     * @param {object} options - optional parameters
     * @param {boolean} [options.excludeLineLocations] - Exclude line location metadata in the metamodel instance
     * @return {string} the metamodel
     */
    static async parse(ctoFiles, resolve = false, all = false, outputPath, options) {
        let result;

        const allFiles = [];
        ctoFiles.forEach((file) => {
            const content = fs.readFileSync(file, 'utf8');
            allFiles.unshift(content);
        });

        const allModels = Parser.parseModels(allFiles, { skipLocationNodes: options && options.excludeLineLocations});
        if (resolve) {
            // First resolve external models
            const allResolvedModels = await External.resolveExternal(allModels, {}, null);
            result = allResolvedModels;
            // Second resolve fully qualified names
            result = MetaModelUtil.resolveLocalNamesForAll(result);
        } else {
            result = allModels;
        }

        // Validate the model
        // await ModelLoader.loadModelManagerFromMetaModel(result);

        if (!all) {
            result = result.models[0];
        }
        if (outputPath) {
            Logger.info('Creating file: ' + outputPath);
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
            return;
        }
        return JSON.stringify(result);
    }

    /**
     * Print a JSON syntax tree to a cto string
     *
     * @param {string} input metamodel
     * @param {string} outputPath to an output file
     * @param {string} transformed (meta)model
     */
    static async print(input, outputPath) {
        const inputString = fs.readFileSync(input, 'utf8');
        const json = JSON.parse(inputString);
        const result = Printer.toCTO(json);
        if (outputPath) {
            Logger.info('Creating file: ' + outputPath);
            fs.writeFileSync(outputPath, result);
            return;
        }
        return result;
    }

    /**
     * Update the version of one or more model files.
     *
     * @param {string} release the release, major/minor/patch, or a semantic version
     * @param {string[]} modelFiles the list of model file paths
     * @param {string} [prerelease] the pre-release version to set
     */
    static async version(release, modelFiles, prerelease) {
        const updatedModelFiles = [];
        for (const modelFile of modelFiles) {
            const resolvedModelFile = path.resolve(modelFile);
            const updatedModelFile = await Commands.versionModelFile(release, resolvedModelFile, prerelease);
            updatedModelFiles.push(updatedModelFile);
        }
        Commands.updateImportsForUpdatedModelFiles(updatedModelFiles);
        Commands.writeUpdatedModelFiles(updatedModelFiles);
    }

    /**
     * Compare two model files and print the results.
     * @param {string} oldPath The path to the old model file.
     * @param {string} newPath The path to the new model file.
     */
    static async compare(oldPath, newPath) {
        const oldContents = fs.readFileSync(path.resolve(oldPath), 'utf-8');
        const newContents = fs.readFileSync(path.resolve(newPath), 'utf-8');
        const modelManager = new ModelManager({ strict: true });
        const oldModelFile = this.getModelFile(modelManager, oldContents);
        const newModelFile = this.getModelFile(modelManager, newContents);
        const results = new Compare().compare(oldModelFile, newModelFile);
        for (const finding of results.findings) {
            const result = compareResultToString(finding.result);
            const coloredResult = this.colorCompareResult(result);
            console.log(`[${finding.key}]: ${finding.message} (${coloredResult})`);
        }
        const result = compareResultToString(results.result);
        const coloredResult = this.colorCompareResult(result);
        console.log('');
        console.log(`overall result: ${coloredResult}`);
        if (result === 'error') {
            process.exit(1);
        }
    }


    /**
     * Generate a sample JSON instance of a Concept
     * @param {string[]} ctoFiles The path to the model file(s).
     * @param {string} concept The fully qualified name of the Concept to generate
     * @param {string} mode Either 'empty' or 'sample'
     * @param {object} options - optional parameters
     * @param {boolean} [options.offline] - do not resolve external models
     * @param {string}  [options.optionalFields] if true, optional fields will be included in the output
     * @param {boolean} [options.strict] - require versioned namespaces and imports
     * @param {boolean} [options.metamodel] - include the Concerto Metamodel
     * @param {boolean} [options.disableValidation] - do not validate the generated output
     */
    static async generate(ctoFiles, concept, mode, options) {
        const modelManagerOptions = { offline: options && options.offline, strict: options && options.strict };

        const modelManager = await ModelLoader.loadModelManager(ctoFiles, modelManagerOptions);
        if (options && options.metamodel) {
            modelManager.addCTOModel(MetaModelUtil.metaModelCto);
        }
        const factory = new Factory(modelManager);

        const factoryOptions = {
            includeOptionalFields: options.optionalFields,
            generate: mode,
        };

        const classDeclaration = modelManager.getType(concept);

        let idFieldName = classDeclaration.getIdentifierFieldName();
        let idField = classDeclaration.getProperty(idFieldName);
        let id = 'resource1';
        if (idField) {
            if(idField.isTypeScalar && idField.isTypeScalar()){
                idField = idField.getScalarField();
            }
            if(idField.validator && idField.validator.regex) {
                id = new RandExp(idField.validator.regex.source, idField.validator.regex.flags).gen();
            }
        }

        const resource = factory.newResource(
            classDeclaration.getNamespace(),
            classDeclaration.getName(),
            classDeclaration.isIdentified() ? id : null,
            factoryOptions
        );
        const serializer = new Serializer(factory, modelManager);

        return Promise.resolve(serializer.toJSON(resource, {validate: !options?.disableValidation}));
    }

    /**
     * Update the version of a model file.
     *
     * @param {string} release the release, major/minor/patch, or a semantic version
     * @param {string} modelFile the model file path
     * @param {string} [prerelease] the pre-release version to set
     * @private
     */
    static async versionModelFile(release, modelFile, prerelease) {
        const data = fs.readFileSync(modelFile, 'utf-8');
        const isMetaModel = Commands.isJSON(data);
        if (isMetaModel) {
            return Commands.versionMetaModelFile(release, modelFile, data, prerelease);

        } else {
            return Commands.versionCtoModelFile(release, modelFile, data, prerelease);
        }
    }

    /**
     * Update (in-place) the imports of one or more updated model files.
     * @param {object[]} updatedModelFiles the updated model files
     * @private
     */
    static updateImportsForUpdatedModelFiles(updatedModelFiles) {
        for (const updatedModelFile of updatedModelFiles) {
            Commands.updateImportsForUpdatedModelFile(updatedModelFiles, updatedModelFile);
        }
    }

    /**
     * Update (in-place) the imports of an updated model file.
     * @param {object[]} updatedModelFiles the updated model files
     * @param {object} updatedModelFile the updated model file to update
     * @private
     */
    static updateImportsForUpdatedModelFile(updatedModelFiles, updatedModelFile) {
        let { newData, cto } = updatedModelFile;
        // Go through each of the other updated model files, and do a string search and
        // replace for the current namespace (old version) with the new namespace (new version).
        for (const otherUpdatedModelFile of updatedModelFiles) {
            // Skip this model file if it has the same namespace.
            if (updatedModelFile.namespace === otherUpdatedModelFile.namespace) {
                continue;
            }
            if (cto) {
                // Ideally we'd be able to parse the CTO to metamodel, edit that and then
                // serialize back to CTO, but that process is lossy.
                newData = newData.split(otherUpdatedModelFile.currentNamespace).join(otherUpdatedModelFile.newNamespace);
            } else {
                const metamodel = JSON.parse(newData);
                for (const imp of metamodel.imports) {
                    if (imp.namespace === otherUpdatedModelFile.currentNamespace) {
                        imp.namespace = otherUpdatedModelFile.newNamespace;
                    }
                }
                newData = JSON.stringify(metamodel, null, 2);
            }
        }
        updatedModelFile.newData = newData;
    }

    /**
     * Write one or more updated model files to the file system.
     * @param {object[]} updatedModelFiles the updated model files
     * @param {object} updatedModelFile the updated model file to update
     * @private
     */
    static writeUpdatedModelFiles(updatedModelFiles) {
        for (const updatedModelFile of updatedModelFiles) {
            Commands.writeUpdatedModelFile(updatedModelFile);
        }
    }

    /**
     * Write one or more updated model files to the file system.
     * @param {object} updatedModelFile the updated model file to update
     * @private
     */
    static writeUpdatedModelFile(updatedModelFile) {
        const {
            cto,
            modelFile,
            newData,
            currentVersion,
            newVersion,
        } = updatedModelFile;
        if (cto) {
            // Sanity check.
            Parser.parse(newData, modelFile);
        }
        fs.writeFileSync(modelFile, newData, 'utf-8');
        Logger.info(`Updated version of "${modelFile}" from "${currentVersion}" to "${newVersion}"`);
    }

    /**
     * Update the version of a metamodel (JSON) model file.
     *
     * @param {string} release the release, major/minor/patch, or a semantic version
     * @param {string} modelFile the model file path
     * @param {string} data the model file data
     * @param {string} [prerelease] the pre-release version to set
     * @private
     */
    static async versionMetaModelFile(release, modelFile, data, prerelease) {
        const metamodel = JSON.parse(data);
        const currentNamespace = metamodel.namespace;
        const [namespace, currentVersion] = currentNamespace.split('@');
        const newVersion = Commands.calculateNewVersion(release, currentVersion, prerelease);
        const newNamespace = [namespace, newVersion].join('@');
        metamodel.namespace = newNamespace;
        const newData = JSON.stringify(metamodel, null, 2);
        return {
            cto: false,        // true === is CTO model file, false === is JSON meta model file
            modelFile,        // the model file path
            newData,          // the new file contents (as a string)
            namespace,        // the namespace, org.acme
            currentNamespace, // the current versioned namespace, org.acme@1.2.3
            newNamespace,     // the new versioned namespace, org.acme@2.0.0
            currentVersion,   // the current version, 1.2.3
            newVersion,       // the new version, 2.0.0
        };
    }

    /**
     * Update the version of a CTO model file.
     *
     * @param {string} release the release, major/minor/patch, or a semantic version
     * @param {string} modelFile the model file path
     * @param {string} data the model file data
     * @param {string} [prerelease] the pre-release version to set
     * @private
     */
    static async versionCtoModelFile(release, modelFile, data, prerelease) {
        const metamodel = Parser.parse(data);
        const currentNamespace = metamodel.namespace;
        const [namespace, currentVersion] = currentNamespace.split('@');
        const newVersion = Commands.calculateNewVersion(release, currentVersion, prerelease);
        const newNamespace = [namespace, newVersion].join('@');
        const regex = new RegExp(`^(\\s*namespace\\s+)${currentNamespace}`, 'gm');
        const newData = data.replace(regex, (match, keyword) => {
            return `${keyword}${newNamespace}`;
        });
        // Sanity check that the replace resulted in a valid CTO model file, and that the namespace
        // change actually took effect. I can't think of a valid test case for this code path, but
        // it will hopefully avoid any silent errors in the future.
        const newMetamodel = Parser.parse(newData);
        /* istanbul ignore next */
        if (newMetamodel.namespace !== newNamespace) {
            throw new Error(`failed to update namespace from "${currentNamespace}" to "${newNamespace}"`);
        }
        return {
            cto: true,        // true === is CTO model file, false === is JSON meta model file
            modelFile,        // the model file path
            newData,          // the new file contents (as a string)
            namespace,        // the namespace, org.acme
            currentNamespace, // the current versioned namespace, org.acme@1.2.3
            newNamespace,     // the new versioned namespace, org.acme@2.0.0
            currentVersion,   // the current version, 1.2.3
            newVersion,       // the new version, 2.0.0
        };
    }

    /**
     * Calculate the new version using the specified release.
     *
     * @param {string} release the release, major/minor/patch, or a semantic version
     * @param {string} currentVersion the current version
     * @param {string} [prerelease] the pre-release version to set
     * @returns {string} the new version
     * @private
     */
    static calculateNewVersion(release, currentVersion, prerelease) {
        if (semver.valid(release)) {
            return release;
        } else if (!semver.valid(currentVersion)) {
            throw new Error(`invalid current version "${currentVersion}"`);
        }
        const result = semver.parse(currentVersion);
        if (release !== 'keep') {
            try {
                result.inc(release);
            } catch (error) {
                throw new Error(`invalid release "${release}"`);
            }
        }
        if (prerelease) {
            result.prerelease = prerelease.split('.');
            return result.format();
        } else {
            return result.toString();
        }
    }

    /**
     * Determine if data is valid JSON or not.
     *
     * @param {string} data the data
     * @returns {boolean} true if JSON, false if not
     * @private
     */
    static isJSON(data) {
        try {
            JSON.parse(data);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Given the specified file contents, parse them as metamodel or CTO.
     * @param {ModelManager} modelManager The model manager.
     * @param {string} contents The file contents.
     * @private
     * @returns {ModelFile} The model file.
     */
    static getModelFile(modelManager, contents) {
        let metamodel;
        try {
            metamodel = JSON.parse(contents);
        } catch (error) {
            metamodel = Parser.parse(contents);
        }
        return new ModelFile(modelManager, metamodel);
    }

    /**
     * Color a string based on the specified compare result.
     * @param {string} result The compare result.
     * @returns {string} The colored string.
     */
    static colorCompareResult(result) {
        const colors = {
            'patch': c.green,
            'minor': c.yellow,
            'major': c.magenta,
            'error': c.red,
        };
        return colors[result] ? colors[result](result) : result;
    }

    /**
     * Generate a Concerto model from another schema format
     * @param {string} input The source file.
     * @param {string} namespace The namepspace for the output model
     * @param {string} [typeName] The name of the root concept
     * @param {string} [format] The source format
     * @param {string} [options] Processing options for inference
     *
     * @returns {string} a CTO string
     */
    static inferConcertoSchema(input, namespace, typeName = 'Root', format = 'jsonSchema', options) {
        let schema = JSON.parse(fs.readFileSync(input, 'utf8'));

        if (format.toLowerCase() === 'openapi'){
            const inferredConcertoJsonModel = CodeGen.OpenApiToConcertoVisitor
                .parse(schema)
                .accept(
                    (new CodeGen.OpenApiToConcertoVisitor),
                    {
                        metaModelNamespace: 'concerto.metamodel@1.0.0',
                        namespace,
                    },
                );

            return Printer.toCTO(
                inferredConcertoJsonModel.models[0]
            );
        }
        const inferredConcertoJsonModel = CodeGen.JSONSchemaToConcertoVisitor
            .parse(schema)
            .accept(
                (new CodeGen.JSONSchemaToConcertoVisitor),
                {
                    metaModelNamespace: 'concerto.metamodel@1.0.0',
                    namespace,
                },
            );

        return Printer.toCTO(
            inferredConcertoJsonModel.models[0]
        );
    }

    /**
     * Decorate a given model with given list of dcs and vocab files and print the result
     * @param {string} modelFiles - the model to which vocab and decorator has to be applied
     * @param {string[]} dcsFiles - the decorator files to be applied to model
     * @param {string[]} vocFiles - the vocab files to be applied to model
     * @param {object} options - optional parameters
     * @param {string} options.format - format of output models (CTO or JSON)
     * @param {string} options.output -  the output directory where the decorated models are to be written
     * @returns {string} - Depending on the options, CTO string or JSON string
     */
    static async decorate(modelFiles, dcsFiles,vocFiles,options) {
        try {
            const allModelContent = modelFiles.map(file => fs.readFileSync(file, 'utf-8'));
            const allDCSFiles = dcsFiles ? dcsFiles.map(file => fs.readFileSync(file, 'utf-8')) : [];
            const allVocsFiles = vocFiles ? vocFiles.map(file => fs.readFileSync(file, 'utf-8')) : [];
            let modelManager = new ModelManager();
            allModelContent.forEach(modelContent => {
                modelManager.addModel(modelContent);
            });
            allDCSFiles.forEach(content => {
                modelManager = DecoratorManager.decorateModels(modelManager, JSON.parse(content));
            });
            const vocManager = new VocabularyManager({ missingTermGenerator: VocabularyManager.englishMissingTermGenerator });
            const namespace = modelManager.getNamespaces().filter(namespace=>namespace!=='concerto@1.0.0' && namespace!=='concerto');
            allVocsFiles.forEach(content => {
                vocManager.addVocabulary(content);
            });
            const vocabKeySet=[];
            namespace.forEach(name=>{
                let vocab = vocManager.getVocabulariesForNamespace(name);
                vocab.forEach(voc=>vocabKeySet.push(voc.getLocale()));
            });
            vocabKeySet.map(voc=>{
                let commandSet = vocManager.generateDecoratorCommands(modelManager, voc);
                modelManager = DecoratorManager.decorateModels(modelManager, commandSet);
            });
            let result=[];
            const extension =  (options.format === 'cto') ? '.cto':'.json';
            namespace.forEach(name=>{
                let model = modelManager.getModelFile(name);
                let modelAst=model.getAst();
                let data =  (options.format === 'cto') ? Printer.toCTO(modelAst):JSON.stringify(modelAst);
                if (options.output) {
                    if (!fs.existsSync(options.output)) {
                        // If it doesn't exist, create the directory
                        fs.mkdirSync(options.output);
                    }
                    const filePath = path.join(options.output, model.namespace.split('@')[0]+extension);
                    fs.writeFileSync(filePath, data);
                }
                result.push(data);
            });
            return result;
        } catch (e) {
            throw new Error(e);
        }
    }

    /**
     * Extract the decorator command sets and vocabularies from a list of modelFiles
     * @param {string} modelFiles - the model from which vocabularies and decorators have to be extracted
     * @param {object} options - optional parameters
     * @param {string} options.locale - locale for extracted vocabularies
     * @param {string} options.removeDecoratorsFromSource -  the flag to determine whether to remove decorators from source model files
     * @param {string} options.output -  the output directory where the extracted models, decorators and vocabularies are to be written
     * @returns {Object} - Extracted models, decorators and vocabularies
     */
    static async extractDecorators(modelFiles, options) {
        try {
            const updatedModels = [];
            const allModelContent = modelFiles.map(file => fs.readFileSync(file, 'utf-8'));
            let modelManager = new ModelManager();
            allModelContent.forEach(modelContent => {
                modelManager.addModel(modelContent);
            });

            const resp = DecoratorManager.extractDecorators(modelManager, options);

            if (!fs.existsSync(options.output)) {
                // If it doesn't exist, create the directory
                fs.mkdirSync(options.output);
            }

            const namespaces = resp.modelManager.getNamespaces().filter(namespace=>namespace!=='concerto@1.0.0' && namespace!=='concerto');
            namespaces.forEach(name=>{
                let model = resp.modelManager.getModelFile(name);
                let modelAst=model.getAst();
                let data =  Printer.toCTO(modelAst);

                updatedModels.push(data);
                const filePath = path.join(options.output, model.namespace.split('@')[0]+'.cto');
                fs.writeFileSync(filePath, data);
            });

            resp.decoratorCommandSet.forEach((dcs, index) => {
                const fileName = 'dcs_'+ index.toString();
                const filePath = path.join(options.output, fileName+'.json');
                fs.writeFileSync(filePath, JSON.stringify(dcs));
            });
            resp.vocabularies.forEach((vocab, index) => {
                const fileName = 'vocabulary_'+ index.toString();
                const filePath = path.join(options.output, fileName+'.yml');
                fs.writeFileSync(filePath, vocab);
            });
            return `Extracted Decorators and models in ${options.output}/.`;
        } catch (e) {
            throw new Error(e);
        }
    }
}

module.exports = Commands;
