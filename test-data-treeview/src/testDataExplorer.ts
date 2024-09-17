import * as vscode from "vscode";
import * as fs from "fs";
import * as https from "https";
import * as fpath from "path";
import * as url from "url";
import AdmZip = require("adm-zip");


export class TestDataProvider implements vscode.TreeDataProvider<TestDataItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestDataItem | undefined | void> = new vscode.EventEmitter<
        TestDataItem | undefined | void
    >();
    readonly onDidChangeTreeData: vscode.Event<TestDataItem | undefined | void> = this._onDidChangeTreeData.event;

    temp: string;
    storagePath: string;
    packagePath: string;
    contentPath: string;

    listing: string = "";
    pullOnline: boolean = true;

    constructor(
        private workspaceRoot: string | undefined,
        storagePath: string,
    ) {
        // Get temporary directory to store transitory files
        this.workspaceRoot = workspaceRoot;
        this.storagePath = storagePath;
        this.temp = storagePath;
        this.packagePath = fpath.join(this.temp, "packages");
        this.contentPath = fpath.join(this.temp, "unpacked");
        this.listing = vscode.workspace.getConfiguration('testDataExplorer')
            ['localListingLocation'];

        fs.mkdirSync(storagePath, { recursive: true });
        fs.mkdirSync(this.packagePath, { recursive: true });
        fs.mkdirSync(this.contentPath, { recursive: true });
    }

    refresh(all: boolean = true): void {
        if (all) {
            this.pullOnline = true;
            this.listing = vscode.workspace.getConfiguration('testDataExplorer')
                ['localListingLocation'];
        }

        this._onDidChangeTreeData.fire();
    }

    clear(all: boolean = true): void {
        fs.rmdirSync(this.packagePath, { recursive: true });
        fs.rmdirSync(this.contentPath, { recursive: true });
        fs.mkdirSync(this.packagePath, { recursive: true });
        fs.mkdirSync(this.contentPath, { recursive: true });

        if (all) {
            this.listing = "";
            this.pullOnline = false;
        }

        this.refresh(false);
    }

    forceDownloadListing() {
        if (this.listing || !this.pullOnline) {
            this.clear(true);
            this.listing = "";
            this.pullOnline = true;
            this.refresh(false);
        }
    }

    loadListing(listing: string) {
        if (!fs.existsSync(listing)) {
            vscode.window.showErrorMessage("Listing does not exist");
            return;
        }

        this.listing = listing;
        this.refresh(false);
    }

    getTreeItem(element: TestDataItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TestDataItem): Thenable<TestDataItem[]> {
        if (element) {
            return Promise.resolve(this.getChildrenItems(element));
        } else {
            return Promise.resolve(this.getTestDataPackages());
        }
    }

    downloadFile(source: string, target: string): Thenable<void> {
        if (fs.existsSync(target)) {
            return Promise.resolve();
        }

        const file = fs.createWriteStream(target);
        console.log("Downloading file from: " + source);

        return new Promise((resolve, reject) => {
            const request = https
                .get(source, function (response) {
                    response
                        .on("error", (err) => {
                            fs.unlink(target, () => {
                                console.log("Failed to download file: " + err.message);
                                vscode.window.showErrorMessage(
                                    "Failed to download file: " + source
                                );
                            });
                            reject(err);
                        })
                        .pipe(file);

                    file.on("finish", () => {
                        file.close(() => {
                            console.log("Downloaded file to: " + target);
                        });
                        resolve();
                    });
                })
                .on("error", (err) => {
                    fs.unlink(target, () => {
                        console.log("Failed to download file: " + err.message);
                        vscode.window.showErrorMessage("Failed to download file: " + source);
                    });

                    reject(err);
                });

            request.end();
        });
    }

    loadTestDataListing(listing?: string): Thenable<TestDataPackage[]> | void {
        let listingPromise: Promise<string>;

        if (listing && fs.existsSync(listing)) {
            listingPromise = Promise.resolve(listing);
        } else if (this.pullOnline) {
            const repo = vscode.workspace.getConfiguration('testDataExplorer')['repository'];
            const branch = vscode.workspace.getConfiguration('testDataExplorer')['branch'];
            const location = vscode.workspace.getConfiguration('testDataExplorer')['remoteListingLocation'];

            console.log("Fetching listing from" + repo + "/" + branch);

            const listing = fpath.join(this.temp, "test_data.json");
            const repoURL = url.format({
                protocol: "https",
                hostname: "raw.githubusercontent.com",
                pathname: repo,
            });

            fs.rmSync(listing, { force: true });
            listingPromise = new Promise((resolve) => {
                this.downloadFile(
                    fpath.join(repoURL, branch, location),
                    listing,
                ).then(() => {
                    resolve(listing);
                });
            });

            return listingPromise.then((listing) => {
                const testPackages: TestDataPackage[] = [];
                const data = JSON.parse(fs.readFileSync(listing, "utf8"));

                for (const key in data) {
                    const value = data[key];
                    testPackages.push(new TestDataPackage(
                        key, vscode.TreeItemCollapsibleState.Collapsed, "", value
                    ));
                }

                return testPackages;
            });
        }
    }

    getTestDataPackages(): Thenable<TestDataPackage[]> {
        return Promise.resolve(this.loadTestDataListing(this.listing) || []);
    }

    getworkspaceURI(): vscode.Uri | undefined {
        if (this.workspaceRoot) {
            return vscode.Uri.file(this.workspaceRoot);
        }
    }

    unpackArchive(archive: string): Thenable<string> {
        const zip = new AdmZip(archive);
        const name = fpath.basename(archive, fpath.extname(archive));
        const content = fpath.join(this.contentPath, name);

        if (fs.existsSync(content)) {
            return Promise.resolve(content);
        }

        return new Promise((resolve, reject) => {
            try {
                zip.extractAllTo(this.contentPath, true);
                resolve(content);
            } catch (err) {
                vscode.window.showErrorMessage("Failed to unpack archive: " + name + ".zip");
                reject(err);
            }
        });
    }

    getFolderContents(folder: string): TestDataItem[] {
        const contents: TestDataItem[] = [];

        for (const file of fs.readdirSync(folder)) {
            const filePath = fpath.join(folder, file);
            const stat = fs.statSync(filePath);
            const relPath = fpath.relative(this.contentPath, filePath);

            if (stat.isFile()) {
                contents.push(new TestDataFile(
                    file, vscode.TreeItemCollapsibleState.None, relPath
                ));
            } else if (stat.isDirectory()) {
                contents.push(new TestDataFolder(
                    file, vscode.TreeItemCollapsibleState.Collapsed, relPath
                ));
            }
        }

        return contents;
    }

    getTestDataPackageContents(element: TestDataPackage): Thenable<TestDataItem[]> {
        const location = fpath.join(element.md5sum.substring(0, 2), element.md5sum.substring(2));
        const packagePath = fpath.join(this.packagePath, element.label);
        const dataURL = url.format({
            protocol: "https",
            hostname: vscode.workspace.getConfiguration('testDataExplorer')['dataserver'],
            pathname: vscode.workspace.getConfiguration('testDataExplorer')['serverdatalocation'],
        });

        return new Promise((resolve) => {
            this.downloadFile(fpath.join(dataURL, location), packagePath).then(() => {
                this.unpackArchive(packagePath).then((location) => {
                    resolve(this.getFolderContents(location));
                });
            });
        });
    }

    getChildrenItems(element: TestDataItem): Thenable<TestDataItem[]> {
        if (element instanceof TestDataPackage) {
            return this.getTestDataPackageContents(element);
        } else if (element instanceof TestDataFolder) {
            return Promise.resolve(this.getFolderContents(
                fpath.join(this.contentPath, element.path)
            ));
        }

        return Promise.resolve([]);
    }

    openInEditor(element: TestDataItem): void {
        Promise.resolve(
            vscode.commands.executeCommand(
                "vscode.open", vscode.Uri.file(fpath.join(this.contentPath, element.path)
                )),
        );
    }

    saveAs(element: TestDataItem): void {
        vscode.window
            .showSaveDialog({
                defaultUri: this.getworkspaceURI(),
                filters: {
                    "All files": ["*"],
                },
            })
            .then((uri) => {
                if (uri) {
                    fs.copyFileSync(fpath.join(this.contentPath, element.path), uri.fsPath);
                }
            });
        }
}

export abstract class TestDataItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly path: string,
        public readonly command?: vscode.Command,
    ) {
        super(label, collapsibleState);
        this.path = path;
    }

    abstract iconPath: { light: string; dark: string } | string;

    contextValue = "testDataItem";
}

export class TestDataPackage extends TestDataItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly path: string,
        public readonly md5sum: string,
        public readonly command?: vscode.Command,
    ) {
        super(label, collapsibleState, path, command);
        this.md5sum = md5sum;
    }

    iconPath = "$(archive)";
}

export class TestDataFolder extends TestDataItem {
    iconPath = "$(file-directory)";
}

export class TestDataFile extends TestDataItem {
    contextValue = "testDataFile";
    iconPath = "$(file)";
}
