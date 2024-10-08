import { TextDocument, Uri } from "vscode";
import { basename, extname } from "path";
import * as fs from "fs";
import { SceneNode, Scene } from "./types";
import { createLogger } from "../utils";

const log = createLogger("scenes.parser");

export class SceneParser {
	private static instance: SceneParser;
	public scenes: Map<string, Scene> = new Map();

	constructor() {
		if (SceneParser.instance) {
			return SceneParser.instance;
		}
		SceneParser.instance = this;
	}

	public parse_scene(document: TextDocument) {
		const path = document.uri.fsPath;
		const stats = fs.statSync(path);

		if (this.scenes.has(path)) {
			const scene = this.scenes.get(path);

			if (scene.mtime == stats.mtimeMs) {
				return scene;
			}
		}

		const scene = new Scene();
		scene.path = path;
		scene.mtime = stats.mtimeMs;
		scene.title = basename(path);

		this.scenes.set(path, scene);

		const text = document.getText();

		for (const match of text.matchAll(/\[ext_resource.*/g)) {
			const line = match[0];
			const type = line.match(/type="([\w]+)"/)?.[1];
			const path = line.match(/path="([\w.:/]+)"/)?.[1];
			const uid = line.match(/uid="([\w:/]+)"/)?.[1];
			const id = line.match(/ id="?([\w]+)"?/)?.[1];

			scene.externalResources[id] = {
				body: line,
				path: path,
				type: type,
				uid: uid,
				id: id,
				index: match.index,
				line: document.lineAt(document.positionAt(match.index)).lineNumber + 1,
			};
		}

		let lastResource = null;
		for (const match of text.matchAll(/\[sub_resource.*/g)) {
			const line = match[0];
			const type = line.match(/type="([\w]+)"/)?.[1];
			const path = line.match(/path="([\w.:/]+)"/)?.[1];
			const uid = line.match(/uid="([\w:/]+)"/)?.[1];
			const id = line.match(/ id="?([\w]+)"?/)?.[1];
			const resource = {
				path: path,
				type: type,
				uid: uid,
				id: id,
				index: match.index,
				line: document.lineAt(document.positionAt(match.index)).lineNumber + 1,
			};
			if (lastResource) {
				lastResource.body = text.slice(lastResource.index, match.index).trimEnd();
			}

			scene.subResources[id] = resource;
			lastResource = resource;
		}

		let root = "";
		const nodes = {};
		let lastNode = null;

		const nodeRegex = /\[node name="([\w]*)"(?: type="([\w]*)")?(?: parent="([\w\/.]*)")?(?: instance=ExtResource\(\s*"?([\w]+)"?\s*\))?\]/g;
		for (const match of text.matchAll(nodeRegex)) {
			const name = match[1];
			const type = match[2] ? match[2] : "PackedScene";
			let parent = match[3];
			const instance = match[4] ? match[4] : 0;
			let _path = "";
			let relativePath = "";

			if (parent == undefined) {
				root = name;
				_path = name;
			} else if (parent == ".") {
				parent = root;
				relativePath = name;
				_path = parent + "/" + name;
			} else {
				relativePath = parent + "/" + name;
				parent = root + "/" + parent;
				_path = parent + "/" + name;
			}
			if (lastNode) {
				lastNode.body = text.slice(lastNode.position, match.index);
				lastNode.parse_body();
			}
			if (lastResource) {
				lastResource.body = text.slice(lastResource.index, match.index).trimEnd();
				lastResource = null;
			}

			const node = new SceneNode(name, type);
			node.path = _path;
			node.description = type;
			node.relativePath = relativePath;
			node.parent = parent;
			node.text = match[0];
			node.position = match.index;
			node.resourceUri = Uri.from({
				scheme: "godot",
				path: _path,
			});
			scene.nodes.set(_path, node);

			if (instance) {
				if (instance in scene.externalResources) {
					node.tooltip = scene.externalResources[instance].path;
					node.resourcePath = scene.externalResources[instance].path;
					if ([".tscn"].includes(extname(node.resourcePath))) {
						node.contextValue += "openable";
					}
				}
				node.contextValue += "hasResourcePath";
			}
			if (_path == root) {
				scene.root = node;
			}
			if (parent in nodes) {
				nodes[parent].children.push(node);
			}
			nodes[_path] = node;

			lastNode = node;
		}

		if (lastNode) {
			lastNode.body = text.slice(lastNode.position, text.length);
			lastNode.parse_body();
		}

		const resourceRegex = /\[resource\]/g;
		for (const match of text.matchAll(resourceRegex)) {
			if (lastResource) {
				lastResource.body = text.slice(lastResource.index, match.index).trimEnd();
				lastResource = null;
			}
		}
		return scene;
	}
}
