"use strict";

import * as vscode from "vscode";

import { TestDataProvider } from "./testDataExplorer";

export function activate(context: vscode.ExtensionContext) {
    const rootPath =
        vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : undefined;

    const storagePath = context.globalStorageUri.fsPath;

    const testDataProvider = new TestDataProvider(rootPath, storagePath);

    vscode.window.registerTreeDataProvider("testDataExplorer", testDataProvider);

    vscode.commands.registerCommand(
        "testDataExplorer.refreshEntry", () => testDataProvider.refresh()
    );

    vscode.commands.registerCommand(
        "testDataExplorer.clearCache", () => testDataProvider.clear(false)
    );

    vscode.commands.registerCommand(
        "testDataExplorer.loadListing", () => {
            vscode.window
                .showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: "Load package listing",
                    filters: {
                        "JSON files": ["json"],
                    },
                    defaultUri: rootPath ? vscode.Uri.file(rootPath) : undefined,
                })
                .then((uri) => {
                    if (uri && uri[0]) {
                        testDataProvider.loadListing(uri[0].fsPath);
                    } else {
                        vscode.window.showErrorMessage("No file selected");
                    }
                });
        }
    );

    vscode.commands.registerCommand(
        "testDataExplorer.forceDownloadListing", () => testDataProvider.forceDownloadListing(),
    );

    vscode.commands.registerCommand(
        "testDataExplorer.openInEditor", (element) => testDataProvider.openInEditor(element)
    );

    vscode.commands.registerCommand(
        "testDataExplorer.saveAs", (element) => testDataProvider.saveAs(element)
    );
}
