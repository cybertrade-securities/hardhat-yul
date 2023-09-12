import {Artifact, Artifacts, ProjectPathsConfig, RunTaskFunction, SolcBuild, CompilerInput, CompilerOutput} from "hardhat/types";
import type {Artifacts as ArtifactsImpl} from "hardhat/internal/artifacts";
import {localPathToSourceName} from "hardhat/utils/source-names";
import {TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD} from "hardhat/builtin-tasks/task-names";
import {Compiler, NativeCompiler} from "hardhat/internal/solidity/compiler";

import path from "path";
import yulp from "yulp";
import * as fs from "fs";
import {YulConfig} from "./types";

export interface ICompiler {
  compile(input: CompilerInput): Promise<CompilerOutput>;
}

async function getCompiler(_yulConfig: YulConfig, run: RunTaskFunction): Promise<ICompiler> {
  const solcBuild: SolcBuild = await run(
    TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
    {
      quiet: true,
      solcVersion: _yulConfig.version,
    }
  );

  let compiler: ICompiler;
  if (solcBuild.isSolcJs) {
    compiler = new Compiler(solcBuild.compilerPath);
  } else {
    compiler = new NativeCompiler(solcBuild.compilerPath);
  }
  return compiler;
}

export async function compileYul(
  _yulConfig: YulConfig,
  paths: ProjectPathsConfig,
  artifacts: Artifacts,
  run: RunTaskFunction
) {
  const files = await getYulSources(paths);

  const allArtifacts = [];
  for (const file of files) {
    const cwdPath = path.relative(process.cwd(), file);

    console.log(`Compiling ${cwdPath}...`);

    const compiler = await getCompiler(_yulConfig, run);
    const yulOutput = await _compileYul(cwdPath, file, _yulConfig, compiler);

    const sourceName = await localPathToSourceName(paths.root, file);
    const artifact = getArtifactFromYulOutput(sourceName, yulOutput);

    await artifacts.saveArtifactAndDebugFile(artifact);
    allArtifacts.push({ ...artifact, artifacts: [artifact.contractName] });

    const artifactsImpl = artifacts as ArtifactsImpl;
    artifactsImpl.addValidArtifacts(allArtifacts);
  }
}

export async function compileYulp(
  _yulConfig: YulConfig,
  paths: ProjectPathsConfig,
  artifacts: Artifacts,
  run: RunTaskFunction
) {
  const files = await getYulpSources(paths);

  const allArtifacts = [];
  for (const file of files) {
    const cwdPath = path.relative(process.cwd(), file);

    console.log(`Compiling ${cwdPath}...`);

    const compiler = await getCompiler(_yulConfig, run);
    const yulOutput = await _compileYulp(cwdPath, file, _yulConfig, compiler);

    const sourceName = await localPathToSourceName(paths.root, file);
    const artifact = getArtifactFromYulOutput(sourceName, yulOutput);

    await artifacts.saveArtifactAndDebugFile(artifact);
    allArtifacts.push({ ...artifact, artifacts: [artifact.contractName] });

    const artifactsImpl = artifacts as ArtifactsImpl;
    artifactsImpl.addValidArtifacts(allArtifacts);
  }
}

async function getYulSources(paths: ProjectPathsConfig) {
  const glob = await import("glob");
  const yulFiles = glob.sync(path.join(paths.sources, "**", "*.yul").replace(/\\/g, '/'));

  return yulFiles;
}

async function getYulpSources(paths: ProjectPathsConfig) {
  const glob = await import("glob");
  const yulpFiles = glob.sync(path.join(paths.sources, "**", "*.yulp").replace(/\\/g, '/'));

  return yulpFiles;
}

function pathToContractName(file: string) {
  const sourceName = path.basename(file);
  return sourceName.substring(0, sourceName.indexOf("."));
}

function getArtifactFromYulOutput(sourceName: string, output: any): Artifact {
  const contractName = pathToContractName(sourceName);

  return {
    _format: "hh-sol-artifact-1", // sig"function add()" makes this work
    contractName,
    sourceName,
    abi: [], // FIXME: create a proper abi which will work with typechain etc...
    bytecode: output.bytecode,
    deployedBytecode: output.deployedBytecode,
    linkReferences: {},
    deployedLinkReferences: {},
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionDebugData: output.functionDebugData,
  };
}

function checkCompilationErrors(filename: string, errors: any) {
  for (const error of errors) {
    if (error.severity !== 'warning') {
      console.error('\x1b[31m%s\x1b[0m',
        `hardhat-yul: error compiling ${filename}:\n${error.formattedMessage}`
      );
    } else {
      console.warn('\x1b[33m%s\x1b[0m',
        `hardhat-yul: warning compiling ${filename}:\n${error.formattedMessage}`)
    }
  }
}

async function _compileYul(filepath: string, filename: string, _yulConfig: YulConfig, compiler: ICompiler) {
  const data = fs.readFileSync(filepath, "utf8");

  const output =
    await compiler.compile({
        language: "Yul",
        sources: { "Target.yul": { content: data } },
        settings: {
          outputSelection: { "*": { "*": ["*"], "": ["*"] } },
          optimizer: {
            enabled: true,
            runs: 0,
            details: {
              yul: true,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              yulDetails: _yulConfig.yulDetails
            },
          },
        },
      }
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  checkCompilationErrors(filename, output.errors);

  const contractObjects = Object.keys(output.contracts["Target.yul"]);
  const bytecode =
    "0x" +
    output.contracts["Target.yul"][contractObjects[0]]["evm"]["bytecode"][
      "object"
    ];
  let deployedBytecode = "0x";
  if (output.contracts["Target.yul"][contractObjects[0]]["evm"]["deployedBytecode"]) {
    deployedBytecode += output.contracts["Target.yul"][contractObjects[0]]["evm"]["deployedBytecode"]["object"];
  }

  return {
    _format: "hh-sol-artifact-1",
    sourceName: filename,
    abi: [], // needs to be an empty array to not cause issues with typechain
    bytecode: bytecode,
    deployedBytecode,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionDebugData: output.contracts["Target.yul"][contractObjects[0]].evm?.deployedBytecode?.functionDebugData
  };
}

async function _compileYulp(filepath: string, filename: string, _yulConfig: YulConfig, compiler: ICompiler) {
  const data = fs.readFileSync(filepath, "utf8");
  const source = yulp.compile(data);
  const output =
    await compiler.compile({
        language: "Yul",
        sources: { "Target.yul": { content: yulp.print(source.results) } },
        settings: {
          outputSelection: { "*": { "*": ["*"], "": ["*"] } },
          optimizer: {
            enabled: true,
            runs: 0,
            details: {
              yul: true,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              yulDetails: _yulConfig.yulDetails
            },
          },
        },
      }
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  checkCompilationErrors(filename, output.errors);

  const contractObjects = Object.keys(output.contracts["Target.yul"]);
  const bytecode =
    "0x" +
    output.contracts["Target.yul"][contractObjects[0]]["evm"]["bytecode"][
      "object"
    ];
  let deployedBytecode = "0x";
  if (output.contracts["Target.yul"][contractObjects[0]]["evm"]["deployedBytecode"]) {
    deployedBytecode += output.contracts["Target.yul"][contractObjects[0]]["evm"]["deployedBytecode"]["object"];
  }
  const abi = source.signatures
    .map((v: any) => v.abi.slice(4, -1))
    .concat(source.topics.map((v: any) => v.abi.slice(6, -1)));
  const contractCompiled = {
    _format: "hh-sol-artifact-1",
    sourceName: filename,
    abi: abi,
    bytecode: bytecode,
    deployedBytecode
  };

  return contractCompiled;
}
