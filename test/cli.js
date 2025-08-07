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

const chai = require('chai');
const expect = chai.expect;
const path = require('path');
const tmp = require('tmp-promise');
const fs = require('fs');
const sinon = require('sinon');
const fetch = require('node-fetch');

chai.should();
chai.use(require('chai-things'));
chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));
global.fetch = fetch;

const Commands = require('../lib/commands');
const { Parser } = require('@accordproject/concerto-cto');

describe('concerto-cli', () => {
    const models = [path.resolve(__dirname, 'models/dom.cto'),path.resolve(__dirname, 'models/money.cto')];
    const offlineModels = [path.resolve(__dirname, 'models/contract.cto'),path.resolve(__dirname, 'models/dom.cto'),path.resolve(__dirname, 'models/money.cto'),path.resolve(__dirname, 'models/person.cto')];
    const input1 = path.resolve(__dirname, 'data/input1.json');
    const input2 = path.resolve(__dirname, 'data/input2.json');
    const inputText1 = fs.readFileSync(input1, 'utf8');
    const inputText2 = fs.readFileSync(input2, 'utf8');

    afterEach(() => {
        sinon.restore();
    });

    describe('#resolveFilePaths', () => {
        it('resolves file paths with glob patterns', () => {
            const filePaths = [
                path.resolve(__dirname, 'models', '*.cto'),
                path.resolve(__dirname, 'models', 'a?b.cto'),
                path.resolve(__dirname, 'models', '{**/*.cto,**/*.json}'),
                path.resolve(__dirname, 'data', 'input1.json')
            ];
            const result = Commands.resolveFilePaths(filePaths);

            // Normalize paths for comparison
            const normalizedResult = result.map(p => path.normalize(p));

            expect(normalizedResult).to.include(path.normalize(path.resolve(__dirname, 'models', 'dom.cto')));
            expect(normalizedResult).to.include(path.normalize(path.resolve(__dirname, 'models', 'money.cto')));
            expect(normalizedResult).to.include(path.normalize(path.resolve(__dirname, 'data', 'input1.json')));
            expect(normalizedResult.length).to.equal(new Set(normalizedResult).size);
        });

        it('handles regular paths without glob patterns', () => {
            const filePaths = [
                path.resolve(__dirname, 'models/dom.cto'),
                path.resolve(__dirname, 'models/money.cto'),
            ];
            const result = Commands.resolveFilePaths(filePaths);
            expect(result).to.deep.equal(filePaths);
        });

        it('avoids adding duplicate paths', () => {
            const filePaths = [
                path.resolve(__dirname, 'models/dom.cto'),
                path.resolve(__dirname, 'models/dom.cto'),
            ];
            const result = Commands.resolveFilePaths(filePaths);
            expect(result.length).to.equal(1);
            expect(result[0]).to.equal(path.resolve(__dirname, 'models/dom.cto'));
        });
    });

    describe('#validateValidateArgs', () => {
        it('no args specified', () => {
            process.chdir(path.resolve(__dirname, 'data'));
            const args  = Commands.validateValidateArgs({
                _: ['validate'],
            });
            args.input.should.match(/input.json$/);
        });

        it('all args specified', () => {
            process.chdir(path.resolve(__dirname, 'data'));
            const args  = Commands.validateValidateArgs({
                _: ['validate'],
                input: 'input1.json'
            });
            args.input.should.match(/input1.json$/);
        });
    });

    describe('#validate (classic)', () => {
        it('should validate against a model', async () => {
            const result = await Commands.validate(input1, models, {offline:false});
            JSON.parse(result).should.deep.equal(JSON.parse(inputText1));
        });

        it('should fail to validate against a model', async () => {
            try {
                const result = await Commands.validate(input2, models, {offline:false});
                JSON.parse(result).should.deep.equal(JSON.parse(inputText2));
            } catch (err) {
                err.message.should.equal('Model violation in the "org.accordproject.money.MonetaryAmount" instance. Invalid enum value of "true" for the field "CurrencyCode".');
            }
        });

        it('should validate against a model (offline)', async () => {
            const result = await Commands.validate(input1, offlineModels, {offline:true});
            JSON.parse(result).should.deep.equal(JSON.parse(inputText1));
        });

        it('should fail to validate against a model (offline)', async () => {
            try {
                const result = await Commands.validate(input2, offlineModels, {offline:true});
                JSON.parse(result).should.deep.equal(JSON.parse(inputText2));
            } catch (err) {
                err.message.should.equal('Model violation in the "org.accordproject.money.MonetaryAmount" instance. Invalid enum value of "true" for the field "CurrencyCode".');
            }
        });

        it('verbose flag specified', () => {
            process.chdir(path.resolve(__dirname, 'data'));
            Commands.validateValidateArgs({
                _: ['validate'],
                verbose: true
            });
        });

        it('bad input.json', () => {
            process.chdir(path.resolve(__dirname, 'data'));
            (() => Commands.validateValidateArgs({
                _: ['validate'],
                input: 'input_en.json'
            })).should.throw('A input.json file is required. Try the --input flag or create a input.json file.');
        });

        it('bad model', () => {
            process.chdir(path.resolve(__dirname, 'data'));
            (() => Commands.validateValidateArgs({
                _: ['validate'],
                model: ['missing.cto']
            })).should.throw('A model.cto file is required. Try the --model flag or create a model.cto file.');
        });
    });

    describe('#validate (functional)', () => {
        it('should validate against a model', async () => {
            const result = await Commands.validate(input1, models, {offline:false, functional: true});
            (typeof result === 'undefined').should.equal(true);
        });

        it('should fail to validate against a model', async () => {
            try {
                await Commands.validate(input2, models, {offline:false, functional: true});
            } catch (err) {
                err.message.should.equal('Model violation in the "undefined" instance. Invalid enum value of "true" for the field "CurrencyCode".');
            }
        });
    });

    describe('#compile', () => {

        it('should compile to a Go model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('GoLang', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a PlantUML model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('PlantUML', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a Typescript model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('Typescript', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a Rust model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('Rust', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a Java model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true});
            await Commands.compile('Java', models, dir.path);
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a JSONSchema model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('JSONSchema', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a XMLSchema model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('XMLSchema', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a GraphQL model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('GraphQL', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to a CSharp model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('CSharp', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to an OData model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('OData', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to an OpenAPI model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('OpenAPI', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should compile to an Protobuf model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('Protobuf', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.above(0);
            dir.cleanup();
        });
        it('should not compile to an unknown model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('BLAH', models, dir.path, {offline:false});
            fs.readdirSync(dir.path).length.should.be.equal(0);
            dir.cleanup();
        });
        it('should compile to a TypeScript model with the metamodel', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('Typescript', models, dir.path, {metamodel: true, offline:false});
            fs.readdirSync(dir.path).should.contain('concerto.metamodel@1.0.0.ts');
            dir.cleanup();
        });
        it('should compile to a CSharp model with the metamodel', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('CSharp', models, dir.path, {metamodel: true, offline:false});
            fs.readdirSync(dir.path).should.contain('concerto.metamodel@1.0.0.cs');
            dir.cleanup();
        });
        it('should compile to a TypeScript model in strict mode', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('Typescript', [], dir.path, {metamodel: true, offline:false, strict: true});
            fs.readdirSync(dir.path).should.not.contain('concerto.ts');
            fs.readdirSync(dir.path).should.contain('concerto@1.0.0.ts');
            dir.cleanup();
        });
        it('should compile to a CSharp model in strict mode', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.compile('CSharp', [], dir.path, {metamodel: true, offline:false, strict: true});
            fs.readdirSync(dir.path).should.not.contain('concerto.cs');
            fs.readdirSync(dir.path).should.contain('concerto@1.0.0.cs');
            dir.cleanup();
        });
    });

    describe('#get', () => {
        it('should save external dependencies', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.get(models, dir.path);
            fs.readdirSync(dir.path).should.eql([
                '@models.accordproject.org.cicero.contract.cto',
                'dom.cto',
                'money.cto'
            ]);
            dir.cleanup();
        });

        it('should save external dependencies for an external model', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            await Commands.get(['https://models.accordproject.org/patents/patent.cto'], dir.path);
            fs.readdirSync(dir.path).should.eql([
                '@models.accordproject.org.address.cto',
                '@models.accordproject.org.geo.cto',
                '@models.accordproject.org.money.cto',
                '@models.accordproject.org.organization.cto',
                '@models.accordproject.org.patents.patent.cto',
                '@models.accordproject.org.person.cto',
                '@models.accordproject.org.product.cto',
                '@models.accordproject.org.usa.residency.cto',
                '@models.accordproject.org.value.cto'
            ]);
            dir.cleanup();
        });
    });

    describe('#parse', async () => {
        it('should transform cto to metamodel', async () => {
            const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'models/contract.json')));
            const result = JSON.parse(await Commands.parse([path.resolve(__dirname, 'models/contract.cto')]));
            result.should.deep.equal(expected);
        });

        it('should transform cto to metamodel and save it', async () => {
            const output = await tmp.file({ unsafeCleanup: true });
            const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'models/contract.json')));
            await Commands.parse([path.resolve(__dirname, 'models/contract.cto')], undefined, undefined, output.path);
            const result = JSON.parse(fs.readFileSync(output.path));
            result.should.deep.equal(expected);
            output.cleanup();
        });

        it('should transform cto to metamodel and resolve names', async () => {
            const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'models/contractResolved.json')));
            const contractFile = path.resolve(__dirname, 'models/contract.cto');
            const result = JSON.parse(await Commands.parse([contractFile], true));
            result.should.deep.equal(expected);
        });

        it('should transform cto to metamodel and resolve names', async () => {
            const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'models/contractResolvedAll.json')));
            const contractFile = path.resolve(__dirname, 'models/contract.cto');
            const result = JSON.parse(await Commands.parse([contractFile], true, true));
            result.should.deep.equal(expected);
        });

        it('should transform cto to metamodel without location info', async () => {
            const contractFile = path.resolve(__dirname, 'models/contract.cto');
            const result = JSON.parse(await Commands.parse([contractFile], true, true, null, { excludeLineLocations: true }));
            JSON.stringify(result).should.not.contain('location');
        });
    });

    describe('#print', async () => {
        it('should transform a metamodel to cto', async () => {
            const expected = fs.readFileSync(path.resolve(__dirname, 'models/contract2.cto'), 'utf-8');
            const metamodel = path.resolve(__dirname, 'models/contract.json');
            const result = await Commands.print(metamodel);
            result.should.equal(expected);
        });

        it('should transform a metamodel to cto and save it', async () => {
            const output = await tmp.file({ unsafeCleanup: true });
            const expected = fs.readFileSync(path.resolve(__dirname, 'models/contract2.cto'), 'utf-8');
            const metamodel = path.resolve(__dirname, 'models/contract.json');
            await Commands.print(metamodel, output.path);
            const result = fs.readFileSync(output.path, 'utf-8');
            result.should.equal(expected);
            output.cleanup();
        });
    });

    describe('#version (simple)', async () => {
        let ctoPath;
        let metamodelPath;

        beforeEach(async () => {
            const sourceCtoPath = path.resolve(__dirname, 'models', 'version.cto');
            const sourceCto = fs.readFileSync(sourceCtoPath, 'utf-8');
            ctoPath = (await tmp.file({ unsafeCleanup: true })).path;
            fs.writeFileSync(ctoPath, sourceCto, 'utf-8');
            metamodelPath = (await tmp.file({ unsafeCleanup: true })).path;
            const metamodel = Parser.parse(sourceCto);
            fs.writeFileSync(metamodelPath, JSON.stringify(metamodel, null, 2), 'utf-8');
        });

        const tests = [
            { name: 'patch', release: 'patch', expectedNamespace: 'org.accordproject.concerto.test@1.2.4' },
            { name: 'minor', release: 'minor', expectedNamespace: 'org.accordproject.concerto.test@1.3.0' },
            { name: 'major', release: 'major', expectedNamespace: 'org.accordproject.concerto.test@2.0.0' },
            { name: 'explicit', release: '4.5.6', expectedNamespace: 'org.accordproject.concerto.test@4.5.6' },
            { name: 'prerelease', release: '5.6.7-pr.3472381', expectedNamespace: 'org.accordproject.concerto.test@5.6.7-pr.3472381' },
            { name: 'keep-and-set-prerelease', release: 'keep', prerelease: 'pr.1234567', expectedNamespace: 'org.accordproject.concerto.test@1.2.3-pr.1234567' }
        ];

        tests.forEach(({ name, release, prerelease, expectedNamespace }) => {

            it(`should patch bump a cto file [${name}]`, async () => {
                await Commands.version(release, [ctoPath], prerelease);
                const cto = fs.readFileSync(ctoPath, 'utf-8');
                const metamodel = Parser.parse(cto);
                metamodel.namespace.should.equal(expectedNamespace);
            });

            it(`should patch bump a metamodel file [${name}]`, async () => {
                await Commands.version(release, [metamodelPath], prerelease);
                const metamodel = JSON.parse(fs.readFileSync(metamodelPath, 'utf-8'));
                metamodel.namespace.should.equal(expectedNamespace);
            });

        });

        it('should reject an invalid release', async () => {
            await Commands.version('foobar', [ctoPath]).should.be.rejectedWith(/invalid release "foobar"/);
        });

        it('should reject an invalid version', async () => {
            const sourceCtoPath = path.resolve(__dirname, 'models', 'badversion.cto');
            await Commands.version('patch', [sourceCtoPath]).should.be.rejectedWith(/invalid current version "undefined"/);
        });

        it('should ignore namespaces in comments if possible #1', async () => {
            const release = 'keep';
            const prerelease = 'pr.1234567';
            const sourceCtoPath = path.resolve(__dirname, 'models', 'version-in-comment.cto');
            const sourceCto = fs.readFileSync(sourceCtoPath, 'utf-8');
            const ctoPath = (await tmp.file({ unsafeCleanup: true })).path;
            fs.writeFileSync(ctoPath, sourceCto, 'utf-8');
            await Commands.version(release, [ctoPath], prerelease);
            const cto = fs.readFileSync(ctoPath, 'utf-8');
            const metamodel = Parser.parse(cto);
            metamodel.namespace.should.equal('org.accordproject.concerto.test@1.2.3-pr.1234567');
        });

        it('should ignore namespaces in comments if possible #2', async () => {
            const release = 'keep';
            const prerelease = 'pr.1234567';
            const sourceCtoPath = path.resolve(__dirname, 'models', 'version-in-comment2.cto');
            const sourceCto = fs.readFileSync(sourceCtoPath, 'utf-8');
            const ctoPath = (await tmp.file({ unsafeCleanup: true })).path;
            fs.writeFileSync(ctoPath, sourceCto, 'utf-8');
            await Commands.version(release, [ctoPath], prerelease);
            const cto = fs.readFileSync(ctoPath, 'utf-8');
            const metamodel = Parser.parse(cto);
            metamodel.namespace.should.equal('org.accordproject.concerto.test@1.2.3-pr.1234567');
        });
    });

    describe('#version (imports)', async () => {
        let ctoPaths;
        let metamodelPaths;

        beforeEach(async () => {
            ctoPaths = [];
            metamodelPaths = [];
            for (const name of ['version-a.cto', 'version-b.cto', 'version-c.cto']) {
                const sourceCtoPath = path.resolve(__dirname, 'models', name);
                const sourceCto = fs.readFileSync(sourceCtoPath, 'utf-8');
                const ctoPath = (await tmp.file({ unsafeCleanup: true })).path;
                ctoPaths.push(ctoPath);
                fs.writeFileSync(ctoPath, sourceCto, 'utf-8');
                const metamodelPath = (await tmp.file({ unsafeCleanup: true })).path;
                metamodelPaths.push(metamodelPath);
                const metamodel = Parser.parse(sourceCto);
                fs.writeFileSync(metamodelPath, JSON.stringify(metamodel, null, 2), 'utf-8');
            }
        });

        const tests = [
            { name: 'patch', release: 'patch', files: [
                {
                    expectedNamespace: 'org.accordproject.concerto.test.a@1.2.4',
                    expectedString: 'org.accordproject.concerto.test.b@2.3.5'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.b@2.3.5',
                    expectedString: 'org.accordproject.concerto.test.c@3.4.6'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.c@3.4.6'
                }
            ]},
            { name: 'minor', release: 'minor', files: [
                {
                    expectedNamespace: 'org.accordproject.concerto.test.a@1.3.0',
                    expectedString: 'org.accordproject.concerto.test.b@2.4.0'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.b@2.4.0',
                    expectedString: 'org.accordproject.concerto.test.c@3.5.0'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.c@3.5.0'
                }
            ]},
            { name: 'major', release: 'major', files: [
                {
                    expectedNamespace: 'org.accordproject.concerto.test.a@2.0.0',
                    expectedString: 'org.accordproject.concerto.test.b@3.0.0'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.b@3.0.0',
                    expectedString: 'org.accordproject.concerto.test.c@4.0.0'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.c@4.0.0'
                }
            ]},
            { name: 'explicit', release: '4.5.6', files: [
                {
                    expectedNamespace: 'org.accordproject.concerto.test.a@4.5.6',
                    expectedString: 'org.accordproject.concerto.test.b@4.5.6'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.b@4.5.6',
                    expectedString: 'org.accordproject.concerto.test.c@4.5.6'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.c@4.5.6'
                }
            ]},
            { name: 'prerelease', release: '5.6.7-pr.3472381', files: [
                {
                    expectedNamespace: 'org.accordproject.concerto.test.a@5.6.7-pr.3472381',
                    expectedString: 'org.accordproject.concerto.test.b@5.6.7-pr.3472381'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.b@5.6.7-pr.3472381',
                    expectedString: 'org.accordproject.concerto.test.c@5.6.7-pr.3472381'
                },
                {
                    expectedNamespace: 'org.accordproject.concerto.test.c@5.6.7-pr.3472381'
                }
            ]},
        ];

        tests.forEach(({ name, release, files }) => {

            it(`should patch bump a cto file [${name}]`, async () => {
                await Commands.version(release, ctoPaths);
                for (const [i, file] of files.entries()) {
                    const { expectedNamespace, expectedString } = file;
                    const cto = fs.readFileSync(ctoPaths[i], 'utf-8');
                    if (expectedString) {
                        cto.should.contain(expectedString);
                    }
                    const metamodel = Parser.parse(cto);
                    metamodel.namespace.should.equal(expectedNamespace);
                }
            });

            it(`should patch bump a metamodel file [${name}]`, async () => {
                await Commands.version(release, metamodelPaths);
                for (const [i, file] of files.entries()) {
                    const { expectedNamespace, expectedString } = file;
                    const data = fs.readFileSync(metamodelPaths[i], 'utf-8');
                    if (expectedString) {
                        data.should.contain(expectedString);
                    }
                    const metamodel = JSON.parse(data);
                    metamodel.namespace.should.equal(expectedNamespace);
                }
            });
        });

    });

    describe('#compare', async () => {
        let processExitStub;

        beforeEach(() => {
            processExitStub = sinon.stub(process, 'exit');
        });

        it('should compare two cto models that require a major change', async () => {
            const aPath = path.resolve(__dirname, 'models', 'compare-a.cto');
            const bPath = path.resolve(__dirname, 'models', 'compare-b.cto');
            await Commands.compare(aPath, bPath);
        });

        it('should compare two cto models that require a minor/patch change', async () => {
            const bPath = path.resolve(__dirname, 'models', 'compare-b.cto');
            const cPath = path.resolve(__dirname, 'models', 'compare-c.cto');
            await Commands.compare(bPath, cPath);
        });

        it('should compare two cto models that have no changes', async () => {
            const aPath = path.resolve(__dirname, 'models', 'compare-a.cto');
            await Commands.compare(aPath, aPath);
        });

        it('should compare two cto models that have a namespace change', async () => {
            const aPath = path.resolve(__dirname, 'models', 'compare-a.cto');
            const bPath = path.resolve(__dirname, 'models', 'compare-a-badns.cto');
            await Commands.compare(aPath, bPath);
            processExitStub.should.have.been.calledWith(1);
        });

        it('should compare two json models that require a major change', async () => {
            const aPath = path.resolve(__dirname, 'models', 'compare-a.json');
            const bPath = path.resolve(__dirname, 'models', 'compare-b.json');
            await Commands.compare(aPath, bPath);
        });

        it('should compare two json models that require a minor/patch change', async () => {
            const bPath = path.resolve(__dirname, 'models', 'compare-b.json');
            const cPath = path.resolve(__dirname, 'models', 'compare-c.json');
            await Commands.compare(bPath, cPath);
        });

        it('should compare two json models that have no changes', async () => {
            const aPath = path.resolve(__dirname, 'models', 'compare-a.json');
            await Commands.compare(aPath, aPath);
        });

        it('should compare two json models that have a namespace change', async () => {
            const aPath = path.resolve(__dirname, 'models', 'compare-a.json');
            const bPath = path.resolve(__dirname, 'models', 'compare-a-badns.json');
            await Commands.compare(aPath, bPath);
            processExitStub.should.have.been.calledWith(1);
        });
    });

    describe('#infer', async () => {
        it('should infer a Concerto model from a JSON Schema', async () => {
            const inferredConcertoModel = await Commands.inferConcertoSchema(
                path.resolve(__dirname, 'models/json-schema-model.json'),
                'com.test@1.0.0',
            );

            const desiredConcertoModel = fs.readFileSync(
                path.resolve(
                    __dirname, 'models/inferred-from-json-schema-model.cto'
                ), 'utf8'
            );

            (inferredConcertoModel + '\n').should.equal(
                desiredConcertoModel
            );
        });

        it('should infer a Concerto model from an Open API definition', async () => {
            const inferredConcertoModel = await Commands.inferConcertoSchema(
                path.resolve(__dirname, 'models/open-api-definition.json'),
                'com.test@1.0.0',
                'Root',
                'openapi'
            );

            const desiredConcertoModel = fs.readFileSync(
                path.resolve(
                    __dirname, 'models/inferred-from-open-api-definition.cto'
                ), 'utf8'
            );

            (inferredConcertoModel + '\n').should.equal(
                desiredConcertoModel
            );
        });
    });


    describe('#generate', async () => {
        it('should generate an object, including metamodel', async () => {
            const obj = await Commands.generate(
                offlineModels,
                'org.accordproject.money.MonetaryAmount',
                'sample',
                { offline: true, optionalFields: true, metamodel: true }
            );
            obj.$class.should.equal('org.accordproject.money.MonetaryAmount');
            (typeof obj.currencyCode).should.equal('string');
            (typeof obj.doubleValue).should.equal('number');
        });

        it('should generate an object', async () => {
            const obj = await Commands.generate(
                offlineModels,
                'org.accordproject.money.MonetaryAmount',
                'sample',
                { offline: true, optionalFields: true }
            );
            obj.$class.should.equal('org.accordproject.money.MonetaryAmount');
            (typeof obj.currencyCode).should.equal('string');
            (typeof obj.doubleValue).should.equal('number');
        });

        it('should generate an identified object', async () => {
            const obj = await Commands.generate(
                offlineModels,
                'org.accordproject.cicero.dom.ContractTemplate',
                'sample',
                { offline: true, optionalFields: true }
            );
            obj.$class.should.equal('org.accordproject.cicero.dom.ContractTemplate');
            Object.keys(obj).should.eql(['$class', 'metadata', 'content', 'id', '$identifier']);
        });

        it('should generate an identified object with an identifier property with regex', async () => {
            const obj = await Commands.generate(
                offlineModels,
                'person@1.0.0.Person',
                'sample',
                { offline: true, optionalFields: true }
            );
            obj.ssn.should.match(/\d{3}-\d{2}-\d{4}/);
        });

        it('should generate an identified object identified by a scalar', async () => {
            const obj = await Commands.generate(
                offlineModels,
                'person@1.0.0.Person2',
                'sample',
                { offline: true, optionalFields: true }
            );
            (typeof obj.ssn).should.equal('string');
        });

        it('should generate an string values within the given length range', async () => {
            const obj = await Commands.generate(
                offlineModels,
                'person@1.0.0.Person',
                'sample',
                { offline: true, optionalFields: true }
            );
            expect(obj.lastName.length >= 1).to.be.true;
            expect(obj.lastName.length <= 10).to.be.true;
            expect(obj.firstName.length <= 10).to.be.true;
            expect(obj.fatherName.length >= 1).to.be.true;
        });
    });

    describe('#decorate', () => {
        it('should apply the list of decorators to model and output in cto by default', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const model = [(path.resolve(__dirname, 'models', 'decorate-model.cto'))];
            const decorators = [path.resolve(__dirname, 'data', 'decorate-dcs.json')];
            const vocabs = undefined;
            const options={
                format:'cto'
            };
            const expected = fs.readFileSync(path.resolve(__dirname, 'models', 'decorate-model-expected-with-dcs.cto'),'utf-8');
            const result =await Commands.decorate(model,decorators,vocabs,options);
            result[1].replace(/[\r\n]+/g, '\n').should.equal(expected.replace(/[\r\n]+/g, '\n'));
            dir.cleanup();
        });

        it('should apply the list of vocabs to the model and output in cto by default', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'decorate-model.cto')];
            const vocabs = [path.resolve(__dirname, 'data', 'decorate-voc')];
            const decorators = undefined;
            const options={
                format:'cto'
            };
            const expected = fs.readFileSync(path.resolve(__dirname, 'models', 'decorate-model-expected-with-vocabs-only.cto'),'utf-8');
            const result =await Commands.decorate(model,decorators,vocabs,options);
            result[1].replace(/[\r\n]+/g, '\n').should.equal(expected.replace(/[\r\n]+/g, '\n'));
            dir.cleanup();
        });

        it('should apply the list of vocabs and list of decorators to the model and output in asked format', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'decorate-model.cto')];
            const vocabs = [path.resolve(__dirname, 'data', 'decorate-voc')];
            const decorators = [path.resolve(__dirname, 'data', 'decorate-dcs.json')];
            const options={
                format:'json'
            };
            const result =await Commands.decorate(model,decorators,vocabs,options);
            const clone = JSON.stringify(result);
            let jsonObj = JSON.parse(clone);
            (typeof jsonObj).should.equal('object');
            dir.cleanup();
        });
        it('should throw error if data is invalid', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'decorate-invalid-model.cto')];
            const vocabs = [path.resolve(__dirname, 'data', 'decorate-voc')];
            const decorators =undefined;
            const options={
                format:'json'
            };
            const expected = fs.readFileSync(path.resolve(__dirname, 'models', 'decorate-model-expected-with-vocabs-and-deco.json'),'utf-8');
            try {
                const result =await Commands.decorate(model,decorators,vocabs,options);
                result.should.eql(expected);
            } catch (err) {
                (typeof err).should.equal('object');
            }
            dir.cleanup();
        });
        it('should write to a file if output is provided', async () => {
            const output = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'decorate-model.cto')];
            const vocabs = [path.resolve(__dirname, 'data', 'decorate-voc')];
            const decorators =undefined;
            const options={
                format:'json',
                output:output.path
            };
            await Commands.decorate(model,decorators,vocabs,options);
            const files = fs.readdirSync(output.path);
            const anyFileExists = files.length > 0;
            expect(anyFileExists).to.be.true;
            output.cleanup();
        });
        it('should write to a file if output is provided and create the directory if it does not exist', async () => {
            const output = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'decorate-model.cto')];
            const vocabs = [path.resolve(__dirname, 'data', 'decorate-voc')];
            const decorators =undefined;
            const options={
                format:'json',
                output:output.path+'_output'
            };
            await Commands.decorate(model,decorators,vocabs,options);
            const files = fs.readdirSync(output.path+'_output');
            const anyFileExists = files.length > 0;
            expect(anyFileExists).to.be.true;
            output.cleanup();
        });
        it('should apply decorators when the model files are having dependency', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'version-c.cto'),path.resolve(__dirname, 'models', 'version-b.cto')];
            const vocabs = undefined;
            const decorators =[path.resolve(__dirname, 'data', 'decorate-dcs.json')];
            const options={
                format:'cto',
            };
            const expected = fs.readFileSync(path.resolve(__dirname, 'models', 'decorate-model-expected-with-dependency.cto'),'utf-8');
            const result =await Commands.decorate(model,decorators,vocabs,options);
            result[1].replace(/[\r\n]+/g, '\n').should.equal(expected.replace(/[\r\n]+/g, '\n'));
            dir.cleanup();
        });
    });

    describe('#extract-decorator', () => {
        it('should extract the vocabularies and decorators from source model and should not alter the original model by default', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const options = {
                locale: 'en-gb',
                output: dir.path
            };
            const model = [(path.resolve(__dirname, 'models', 'extract-deco-and-vocab.cto'))];
            const expectedModels = fs.readFileSync(path.resolve(__dirname, 'models', 'extract-deco-and-vocab.cto'),'utf-8');
            const expectedVocabs = 'locale: en-gb\nnamespace: test@1.0.0\ndeclarations:\n  - Person: Person Class\n    properties:\n      - firstName: HI\n      - bio: some\n        cus: con\n';
            const expectedDecos = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data', 'extract-expected-deco.json'),'utf-8'));
            const result = await Commands.extractDecorators(model, options);
            const actualModels = fs.readFileSync(path.resolve(dir.path, 'test.cto'),'utf-8');
            const actualVocabs = fs.readFileSync(path.resolve(dir.path, 'vocabulary_0.yml'),'utf-8');
            const actualDecorators = JSON.parse(fs.readFileSync(path.resolve(dir.path, 'dcs_2.json'),'utf-8'));
            result.should.include('Extracted Decorators and models in');
            actualDecorators.should.eql(expectedDecos);
            actualVocabs.should.eql(expectedVocabs);
            actualModels.replace(/[\r\n]+/g, '\n').trim().should.eql(expectedModels.replace(/[\r\n]+/g, '\n').trim());
            dir.cleanup();
        });
        it('should throw error if data is invalid', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const model = [path.resolve(__dirname, 'models', 'decorate-invalid-model.cto')];
            const expected = fs.readFileSync(path.resolve(__dirname, 'models', 'decorate-model-expected-with-vocabs-and-deco.json'),'utf-8');
            try {
                const result =await Commands.extractDecorators(model);
                result.should.eql(expected);
            } catch (err) {
                (typeof err).should.equal('object');
            }
            dir.cleanup();
        });
        it('should extract the vocabularies and decorators from source model and update the source model depending on options passed', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const options = {
                locale: 'en-gb',
                removeDecoratorsFromModel: true,
                output: dir.path
            };
            const model = [(path.resolve(__dirname, 'models', 'extract-deco-and-vocab.cto'))];
            const expectedModels = fs.readFileSync(path.resolve(__dirname, 'models', 'extracted-model.cto'),'utf-8');
            const expectedVocabs = 'locale: en-gb\nnamespace: test@1.0.0\ndeclarations:\n  - Person: Person Class\n    properties:\n      - firstName: HI\n      - bio: some\n        cus: con\n';
            const expectedDecos = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data', 'extract-expected-deco.json'),'utf-8'));
            const result = await Commands.extractDecorators(model, options);
            const actualModels = fs.readFileSync(path.resolve(dir.path, 'test.cto'),'utf-8');
            const actualVocabs = fs.readFileSync(path.resolve(dir.path, 'vocabulary_0.yml'),'utf-8');
            const actualDecorators = JSON.parse(fs.readFileSync(path.resolve(dir.path, 'dcs_2.json'),'utf-8'));
            result.should.include('Extracted Decorators and models');
            actualDecorators.should.eql(expectedDecos);
            actualVocabs.should.eql(expectedVocabs);
            actualModels.replace(/[\r\n]+/g, '\n').trim().should.eql(expectedModels.replace(/[\r\n]+/g, '\n').trim());
            dir.cleanup();
        });
        it('should extract the vocabularies and decorators from source model and write result in given folder', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const options = {
                locale: 'en-gb',
                output: dir.path
            };
            const model = [(path.resolve(__dirname, 'models', 'extract-deco-and-vocab.cto'))];
            await Commands.extractDecorators(model, options);
            const files = fs.readdirSync(dir.path);
            const threeFilesExist = files.length === 6;
            expect(threeFilesExist).to.be.true;
            dir.cleanup();
        });
        it('should extract the vocabularies and decorators from source model and write result in given folder (create folder if does not exist)', async () => {
            const dir = await tmp.dir({ unsafeCleanup: true });
            const options = {
                locale: 'en-gb',
                output: dir.path + '_output'
            };
            const model = [(path.resolve(__dirname, 'models', 'extract-deco-and-vocab.cto'))];
            await Commands.extractDecorators(model, options);
            const files = fs.readdirSync(dir.path + '_output');
            const threeFilesExist = files.length === 6;
            expect(threeFilesExist).to.be.true;
            dir.cleanup();
        });
    });

    describe('#convert-dcs', () => {
        const dcsJsonFile = path.resolve(__dirname, 'data/decorate-dcs.json');
        const dcsYamlFile = path.resolve(__dirname, 'data/decorate-dcs.yaml');
        const expectedJsonContent = fs.readFileSync(dcsJsonFile, 'utf8');
        const expectedYamlContent = fs.readFileSync(dcsYamlFile, 'utf8');

        it('should convert DCS JSON to YAML (console output)', async () => {
            const result = await Commands.convertDcs(dcsJsonFile);
            result.should.be.a('string');
            result.should.equal(expectedYamlContent);
        });

        it('should convert DCS YAML to JSON (console output)', async () => {
            const result = await Commands.convertDcs(dcsYamlFile);
            result.should.be.an('object');
            JSON.stringify(result).should.equal(JSON.stringify(JSON.parse(expectedJsonContent)));
        });

        it('should convert DCS JSON to YAML (file output)', async () => {
            const outputFile = '/test/output.yaml';
            const writeFileStub = sinon.stub(fs, 'writeFileSync');
            sinon.stub(fs, 'existsSync').returns(true);
            sinon.stub(fs, 'readFileSync').withArgs(dcsJsonFile, 'utf-8').returns(expectedJsonContent);
            sinon.stub(fs, 'mkdirSync');

            const result = await Commands.convertDcs(dcsJsonFile, outputFile);
            result.should.include('Successfully converted');
            writeFileStub.should.have.been.calledWith(outputFile, expectedYamlContent);
        });

        it('should convert DCS YAML to JSON (file output)', async () => {
            const outputFile = '/test/output.json';
            const writeFileStub = sinon.stub(fs, 'writeFileSync');
            sinon.stub(fs, 'existsSync').returns(true);
            sinon.stub(fs, 'readFileSync').withArgs(dcsYamlFile, 'utf-8').returns(expectedYamlContent);
            sinon.stub(fs, 'mkdirSync');

            const result = await Commands.convertDcs(dcsYamlFile, outputFile);
            result.should.include('Successfully converted');
            writeFileStub.should.have.been.calledWith(outputFile, JSON.stringify(JSON.parse(expectedJsonContent), null, 4));
        });

        it('should create output directory if it does not exist', async () => {
            const outputFile = '/test/new/nested/directory/output.yaml';
            const existsStub = sinon.stub(fs, 'existsSync');
            existsStub.withArgs(dcsJsonFile).returns(true);
            existsStub.withArgs('/test/new/nested/directory').returns(false);
            sinon.stub(fs, 'readFileSync').withArgs(dcsJsonFile, 'utf-8').returns(expectedJsonContent);
            const mkdirSyncStub = sinon.stub(fs, 'mkdirSync');
            sinon.stub(fs, 'writeFileSync');

            const result = await Commands.convertDcs(dcsJsonFile, outputFile);
            result.should.include('Successfully converted');
            mkdirSyncStub.should.have.been.calledWith('/test/new/nested/directory', { recursive: true });
        });

        it('should throw error if input file does not exist', async () => {
            const nonExistentFile = '/test/nonexistent.json';
            sinon.stub(fs, 'existsSync').returns(false);

            try {
                await Commands.convertDcs(nonExistentFile);
                throw new Error('Should have thrown error');
            } catch (err) {
                err.message.should.include('DCS file does not exist');
            }
        });

        it('should throw error if input has unsupported file format', async () => {
            const unsupportedFile = '/test/test.txt';
            sinon.stub(fs, 'existsSync').returns(true);
            sinon.stub(fs, 'readFileSync').returns('some content');

            try {
                await Commands.convertDcs(unsupportedFile);
                throw new Error('Should have thrown error');
            } catch (err) {
                err.message.should.include('Unsupported input file format');
            }
        });

        it('should throw error if output extension mismatches when converting JSON to YAML', async () => {
            const wrongOutputFile = '/test/output.json';
            sinon.stub(fs, 'existsSync').returns(true);
            sinon.stub(fs, 'readFileSync').withArgs(dcsJsonFile, 'utf-8').returns(expectedJsonContent);

            try {
                await Commands.convertDcs(dcsJsonFile, wrongOutputFile);
                throw new Error('Should have thrown error');
            } catch (err) {
                err.message.should.include('Output file extension should be .yaml or .yml when converting from JSON');
            }
        });

        it('should throw error if output extension mismatches when converting YAML to JSON', async () => {
            const wrongOutputFile = '/test/output.yaml';
            sinon.stub(fs, 'existsSync').returns(true);
            sinon.stub(fs, 'readFileSync').withArgs(dcsYamlFile, 'utf-8').returns(expectedYamlContent);

            try {
                await Commands.convertDcs(dcsYamlFile, wrongOutputFile);
                throw new Error('Should have thrown error');
            } catch (err) {
                err.message.should.include('Output file extension should be .json when converting from YAML');
            }
        });

        it('should handle .yml extension', async () => {
            const ymlFile = '/test/test.yml';
            sinon.stub(fs, 'existsSync').returns(true);
            sinon.stub(fs, 'readFileSync').returns(expectedYamlContent);

            const result = await Commands.convertDcs(ymlFile);
            result.should.be.an('object');
            JSON.stringify(result).should.equal(JSON.stringify(JSON.parse(expectedJsonContent)));
        });

    });
});
