#!/usr/bin/env node
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

const Logger = require('@accordproject/concerto-util').Logger;
const fs = require('fs');
const { glob } = require('glob');
const Commands = require('./lib/commands');

require('yargs')
    .scriptName('concerto')
    .demandCommand(1, '# Please specify a command')
    .recommendCommands()
    .strict()
    .usage('$0 <cmd> [args]')
    .command('validate', 'validate JSON against model files', (yargs) => {
        yargs.option('input', {
            describe: 'JSON to validate',
            type: 'string'
        });
        yargs.option('model', {
            describe: 'array of concerto model files',
            type: 'string',
            array: true
        });
        yargs.option('utcOffset', {
            describe: 'set UTC offset',
            type: 'number'
        });
        yargs.option('offline', {
            describe: 'do not resolve external models',
            type: 'boolean',
            default: false
        });
        yargs.option('functional', {
            describe: 'new validation API',
            type: 'boolean',
            default: false
        });
    }, (argv) => {
        if (argv.verbose) {
            Logger.info(`validate ${argv.input} against the models ${argv.model}`);
        }

        try {
            argv = Commands.validateValidateArgs(argv);
            const options = {};
            options.offline = argv.offline;
            if (argv.utcOffset !== undefined) {
                options.utcOffset = argv.utcOffset;
            }
            options.functional = argv.functional;
            return Commands.validate(argv.input, argv.model, options)
                .then((result) => {
                    Logger.info('Input is valid');
                    if (!options.functional) {
                        console.log(result);
                    }
                })
                .catch((err) => {
                    Logger.info('Input is invalid');
                    Logger.error(err);
                });
        } catch (err){
            Logger.error(err);
            return;
        }
    })
    .command('compile', 'generate code for a target platform', (yargs) => {
        yargs.option('model', {
            describe: 'array of concerto model files',
            type: 'string',
            array: true,
            default: [],
        });
        yargs.option('offline', {
            describe: 'do not resolve external models',
            type: 'boolean',
            default: false
        });
        yargs.option('target', {
            describe: 'target of the code generation',
            type: 'string',
            default: 'JSONSchema'
        });
        yargs.option('output', {
            describe: 'output directory path',
            type: 'string',
            default: './output/'
        });
        yargs.option('metamodel', {
            describe: 'Include the Concerto Metamodel in the output',
            type: 'boolean',
            default: false,
        });
        yargs.option('strict', {
            describe: 'Require versioned namespaces and imports',
            type: 'boolean',
            default: false,
        });
        yargs.option('useSystemTextJson', {
            describe: 'Compile for System.Text.Json library (`csharp` target only)',
            type: 'boolean',
            default: false
        });
        yargs.option('useNewtonsoftJson', {
            describe: 'Compile for Newtonsoft.Json library (`csharp` target only)',
            type: 'boolean',
            default: false
        });
        yargs.option('namespacePrefix', {
            describe: 'A prefix to add to all namespaces (`csharp` target only)',
            type: 'string',
        });
        yargs.option('enableReferenceType', {
            describe: 'Enable resolving referential type id (`csharp` target only)',
            type: 'boolean',
            default: false
        });
        yargs.option('pascalCase', {
            describe: 'Use PascalCase for generated identifier names',
            type: 'boolean',
            default: true
        });
        yargs.option('showCompositionRelationships', {
            describe: 'Show UML Composition Relationships in diagrams (`plantuml` and `mermaid` targets only)',
            type: 'boolean',
            default: false
        });
        yargs.option('hideBaseModel', {
            describe: 'Hide the base concerto namespace in diagrams (`plantuml` and `mermaid` targets only)',
            type: 'boolean',
            default: false
        });
        yargs.check(({ model, metamodel }) => {
            if (model.length > 0 || metamodel) {
                return true;
            } else {
                throw new Error('Please provide models, or specify metamodel');
            }
        });
    }, (argv) => {
        if (argv.verbose) {
            Logger.info(`generate code for target ${argv.target} from models ${argv.model} into directory: ${argv.output}`);
        }

        const options = {};
        options.offline = argv.offline;
        options.strict = argv.strict;
        options.metamodel = argv.metamodel;
        options.useSystemTextJson = argv.useSystemTextJson;
        options.useNewtonsoftJson = argv.useNewtonsoftJson;
        options.namespacePrefix = argv.namespacePrefix;
        options.enableReferenceType = argv.enableReferenceType;
        options.pascalCase = argv.pascalCase;
        options.hideBaseModel = argv.hideBaseModel;
        options.showCompositionRelationships = argv.showCompositionRelationships;
        return Commands.compile(argv.target, argv.model, argv.output, options)
            .then((result) => {
                Logger.info(result);
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('get', 'save local copies of external model dependencies', (yargs) => {
        yargs.demandOption(['model'], 'Please provide models');
        yargs.option('model', {
            describe: 'array of concerto model files',
            type: 'string',
            array: true
        });
        yargs.option('output', {
            describe: 'output directory path',
            type: 'string',
            default: './'
        });
    }, (argv) => {
        if (argv.verbose) {
            Logger.info(`saving external models from ${argv.model} into directory: ${argv.output}`);
        }

        return Commands.get(argv.model, argv.output)
            .then((result) => {
                Logger.info(result);
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('parse', 'parse a cto string to a JSON syntax tree', (yargs) => {
        yargs.demandOption(['model'], 'Please provide Concerto model(s)');
        yargs.option('model', {
            describe: 'array of concerto model files',
            type: 'string',
            array: true
        });
        yargs.option('resolve', {
            describe: 'resolve names to fully qualified names',
            type: 'boolean',
            default: false
        });
        yargs.option('all', {
            describe: 'import all models',
            type: 'boolean',
            default: false
        });
        yargs.option('output', {
            describe: 'path to the output file',
            type: 'string'
        });
        yargs.option('excludeLineLocations', {
            describe: 'Exclude file line location metadata from metamodel instance',
            type: 'boolean',
            default: false
        });
    }, (argv) => {
        const options = {};
        options.excludeLineLocations = argv.excludeLineLocations;

        return Commands.parse(argv.model, argv.resolve, argv.all, argv.output, options)
            .then((result) => {
                if (result) {
                    console.log(result);
                }
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('print', 'print a JSON syntax tree to a cto string', (yargs) => {
        yargs.demandOption(['input'], 'Please provide an input Concerto syntax tree');
        yargs.option('input', {
            describe: 'the metamodel to export',
            type: 'string'
        });
        yargs.option('output', {
            describe: 'path to the output file',
            type: 'string'
        });
    }, (argv) => {
        return Commands.print(argv.input, argv.output)
            .then((result) => {
                if (result) {
                    Logger.info(result);
                }
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('version <release>', 'modify the version of one or more model files', yargs => {
        yargs.demandOption(['model'], 'Please provide Concerto model(s)');
        yargs.positional('release', {
            describe: 'the new version, or a release to use when incrementing the existing version',
            type: 'string',
            choices: [
                'keep',
                'major',
                'minor',
                'patch',
                'premajor',
                'preminor',
                'prepatch',
                'prerelease'
            ]
        });
        yargs.option('model', {
            alias: 'models',
            describe: 'array of concerto model files',
            type: 'string',
            array: true
        });
        yargs.option('prerelease', {
            describe: 'set the specified pre-release version',
            type: 'string'
        });
    }, argv => {
        const modelFiles = argv.model.flatMap(model => {
            if (glob.hasMagic(model)) {
                return glob.sync(model);
            }
            return model;
        });
        return Commands.version(argv.release, modelFiles, argv.prerelease)
            .then((result) => {
                if (result) {
                    Logger.info(result);
                }
            });
    })
    .command('compare', 'compare two Concerto model files', yargs => {
        yargs.demandOption(['old'], 'Please provide the old model');
        yargs.demandOption(['new'], 'Please provide the new model');
        yargs.option('old', {
            describe: 'the old Concerto model file',
            type: 'string',
        });
        yargs.option('new', {
            describe: 'the new Concerto model file',
            type: 'string',
        });
    }, argv => {
        return Commands.compare(argv.old, argv.new)
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('infer', 'generate a concerto model from a source schema', (yargs) => {
        yargs.demandOption(['input', 'namespace']);
        yargs.option('input', {
            describe: 'path to the input file',
            type: 'string',
        });
        yargs.option('output', {
            describe: 'path to the output file',
            type: 'string',
        });
        yargs.option('format', {
            describe: 'either `openapi` or `jsonSchema`',
            default: 'jsonSchema',
            type: 'string'
        });
        yargs.option('namespace', {
            describe: 'The namespace for the output model',
            type: 'string',
        });
        yargs.option('typeName', {
            describe: 'The name of the root type',
            type: 'string',
            default: 'Root'
        });
    }, (argv) => {
        if (argv.verbose) {
            Logger.info(`Infer Concerto model from ${argv.input} in the ${argv.format} format`);
        }

        try {
            const cto = Commands.inferConcertoSchema(argv.input, argv.namespace, argv.typeName, argv.format, argv.output);
            if (argv.output){
                fs.writeFileSync(argv.output, cto);
            } else {
                console.log(cto);
            }
        } catch (err){
            Logger.error(err);
            return;
        }
    })
    .command('generate <mode>', 'generate a sample JSON object for a concept', yargs => {
        yargs.demandOption(['model'], 'Please provide a model');
        yargs.demandOption(['concept'], 'Please provide the concept name');
        yargs.option('model', {
            describe: 'The file location of the source models',
            type: 'string',
            array: true,
        });
        yargs.option('concept', {
            describe: 'The fully qualified name of the Concept type to generate',
            type: 'string',
        });
        yargs.positional('mode', {
            describe: 'Generation mode. `empty` will generate a minimal example, `sample` will generate random values',
            type: 'string',
            choices: [
                'sample',
                'empty',
            ]
        });
        yargs.option('includeOptionalFields', {
            describe: 'Include optional fields will be included in the output',
            type: 'boolean',
            default: false
        });
        yargs.option('metamodel', {
            describe: 'Include the Concerto Metamodel in the output',
            type: 'boolean',
            default: false,
        });
        yargs.option('strict', {
            describe: 'Require versioned namespaces and imports',
            type: 'boolean',
            default: false,
        });
        yargs.option('disableValidation', {
            describe: 'Do not validate generated output',
            type: 'boolean',
            default: false
        });
    }, argv => {
        return Commands.generate(argv.model, argv.concept, argv.mode, {
            optionalFields: argv.includeOptionalFields,
            metamodel: argv.metamodel,
            strict: argv.strict,
            disableValidation: argv.disableValidation
        })
            .then(obj => {
                console.log(JSON.stringify(obj, null, 2));
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('decorate', 'apply the decorators and vocabs to the target models from given list of dcs files and vocab files', yargs => {
        yargs.demandOption('models', 'Please provide a model');
        yargs.option('models', {
            describe: 'The file location of the source models',
            alias: 'model',
            type: 'string',
            array:true,
        });
        yargs.option('decorator', {
            describe: 'List of dcs files to be applied to model',
            type: 'string',
            array:true
        });
        yargs.option('vocabulary', {
            describe: 'List of vocab files to be applied to model',
            type: 'string',
            array:true
        });
        yargs.option('format', {
            describe: 'Output format (json or cto)',
            type: 'string',
            default:'cto',
            choices: ['json', 'cto']
        });
        yargs.option('output', {
            describe: 'output directory path',
            type: 'string',
        });
        yargs.check((args) => {
            // Custom validation to ensure at least one of the two options is provided
            if (!args.decorator && !args.vocabulary) {
                throw new Error('You must provide at least one of dcs files or voc files');
            }
            return true;
        });
    }, argv => {
        let options={};
        options.format=argv.format;
        options.output=argv.output;

        return Commands.decorate(argv.models, argv.decorator,argv.vocabulary,options)
            .then(obj => {
                console.log(obj);
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('extract-decorators','extracts the decorator command sets and vocabularies from a list of model files', yargs =>{
        yargs.demandOption('models','Please provide a model');
        yargs.option('models', {
            describe: 'The file location of the source models',
            alias: 'model',
            type: 'string',
            array:true,
        });
        yargs.option('locale', {
            describe: 'The locale for extracted vocabularies',
            type: 'string',
            default:'en'
        });
        yargs.option('removeDecoratorsFromSource', {
            describe: 'Flag to determine whether to remove decorators from source model',
            type: 'boolean',
            default: false
        });
        yargs.option('output', {
            describe: 'output directory path',
            type: 'string',
            default: 'output'
        });
    }, argv => {
        const options = {
            locale: argv.locale,
            removeDecoratorsFromModel: argv.removeDecoratorsFromSource,
            output: argv.output
        };
        return Commands.extractDecorators(argv.models,options)
            .then(result => {
                Logger.info(result);
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .command('convert-dcs', 'convert decorator command set between JSON and YAML formats', (yargs) => {
        yargs.demandOption('dcs', 'Please provide a DCS file');
        yargs.option('dcs', {
            describe: 'The input DCS file (.json or .yaml/.yml)',
            type: 'string'
        });
        yargs.option('output', {
            describe: 'The output file path (.json or .yaml/.yml). If not provided, outputs to console',
            type: 'string'
        });
    }, (argv) => {
        return Commands.convertDcs(argv.dcs, argv.output)
            .then((result) => {
                if (!argv.output) {
                    // Output to console with proper formatting
                    if (typeof result === 'string') {
                        console.log(result);
                    } else {
                        console.log(JSON.stringify(result, null, 4));
                    }
                } else {
                    Logger.info(result);
                }
            })
            .catch((err) => {
                Logger.error(err.message);
            });
    })
    .option('verbose', {
        alias: 'v',
        default: false
    })
    .help()
    .argv;
