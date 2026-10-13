/**
 * Live2D model package importer.
 *
 * Receives a .zip archive, unpacks it into a staging directory, searches
 * recursively for a valid Live2D model (.model3.json or moc2 settings),
 * validates the moc version (<= v5) and asset files, copies the model into
 * the user's model directory (under `imported/<safe-name>`), and returns
 * the imported model metadata.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execFileSync } from "node:child_process";

export interface ImportResult {
	ok: boolean;
	name?: string;
	label?: string;
	kind?: "moc2" | "moc3";
	group?: string;
	error?: string;
	details?: string;
}

/** 探测一个目录的模型设置文件（moc3 优先，其次任意 moc2 设置 JSON）。 */
export function findSettingsInDir(dirPath: string): { file: string; kind: "moc2" | "moc3" } | null {
	try {
		const entries = readdirSync(dirPath);
		const moc3 = entries.find((file) => file.endsWith(".model3.json"));
		if (moc3) return { file: moc3, kind: "moc3" };

		for (const file of entries.filter((f) => /\.json$/i.test(f))) {
			try {
				const raw = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
				if (raw && raw.type === "Live2D Model Setting" && typeof raw.model === "string" && /\.moc$/i.test(raw.model)) {
					return { file, kind: "moc2" };
				}
			} catch {
				// not a moc2 settings file
			}
		}
	} catch {
		// directory read failed
	}
	return null;
}

/** 递归查找包含 Live2D 模型设置的最浅子目录（最多 5 层）。 */
export function findDeepModelDir(rootDir: string, maxDepth = 5): { dir: string; file: string; kind: "moc2" | "moc3" } | null {
	const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const found = findSettingsInDir(current.dir);
		if (found) {
			return { dir: current.dir, file: found.file, kind: found.kind };
		}
		if (current.depth >= maxDepth) continue;

		try {
			const entries = readdirSync(current.dir);
			for (const entry of entries) {
				const sub = join(current.dir, entry);
				try {
					if (statSync(sub).isDirectory()) {
						queue.push({ dir: sub, depth: current.depth + 1 });
					}
				} catch {}
			}
		} catch {}
	}
	return null;
}

/** 校验 moc3 二进制版本（必须 <= 5，防止不支持的 v6 导致页面白屏）。 */
export function validateMoc3Version(mocPath: string): { ok: boolean; version?: number; error?: string } {
	try {
		const buf = Buffer.alloc(16);
		const fd = readFileSync(mocPath);
		if (fd.length < 5) return { ok: false, error: "moc3 文件损坏或过小" };

		const magic = fd.subarray(0, 4).toString("ascii");
		if (magic !== "MOC3") {
			return { ok: false, error: "文件头部魔数不是 MOC3" };
		}
		const version = fd.readUInt8(4);
		if (version > 5) {
			return {
				ok: false,
				version,
				error: `该模型为 Cubism 5.3 (moc3 v${version}) 格式，官方 Web 核心仅支持至 v5，暂无法在浏览器渲染`,
			};
		}
		return { ok: true, version };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** 清理并标准化文件夹名称。 */
export function sanitizeModelFolderName(raw: string): string {
	const clean = raw
		.replace(/[\\/:\*\?"<>\|]+/g, "-")
		.replace(/[^\p{L}\p{N}_\-\.]+/gu, "-")
		.replace(/^\.+|\.+$/g, "")
		.replace(/^-+|-+$/g, "")
		.trim();
	return clean.slice(0, 60) || "imported-model";
}

/**
 * 处理导入的 zip 文件并安装到模型目录。
 *
 * @param zipFilePath 临时存储的 zip 文件绝对路径
 * @param originalFilename 上传时的原始文件名（如 "Haru.zip"）
 * @param modelRoot 当前配置的 modelPath
 */
export async function installModelZip(
	zipFilePath: string,
	originalFilename: string,
	modelRoot: string,
): Promise<ImportResult> {
	const stagingDir = join(tmpdir(), `lv-import-stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

	try {
		mkdirSync(stagingDir, { recursive: true });

		// 1. 解压 zip
		try {
			execFileSync("unzip", ["-qq", "-o", zipFilePath, "-d", stagingDir]);
		} catch (err) {
			return {
				ok: false,
				error: "解压失败：上传的文件可能不是有效的 ZIP 压缩包",
				details: err instanceof Error ? err.message : String(err),
			};
		}

		// 2. 扫描模型目录与配置文件
		const detected = findDeepModelDir(stagingDir);
		if (!detected) {
			return {
				ok: false,
				error: "未在压缩包内发现 Live2D 模型配置文件（缺少 .model3.json 或 .model.json）",
			};
		}

		// 3. 校验模型格式及 moc3 版本
		if (detected.kind === "moc3") {
			const settingsPath = join(detected.dir, detected.file);
			try {
				const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
				const mocRel = settings?.FileReferences?.Moc;
				if (typeof mocRel === "string") {
					const mocFile = join(detected.dir, mocRel);
					if (existsSync(mocFile)) {
						const mocCheck = validateMoc3Version(mocFile);
						if (!mocCheck.ok) {
							return { ok: false, error: mocCheck.error };
						}
					}
				}
			} catch (e) {
				return { ok: false, error: "模型配置文件 JSON 解析失败", details: String(e) };
			}
		}

		// 4. 确定最终安装目录
		// 目标根目录必须存在；若用户尚未配置，默认落 ~/.dsh/live2d-voice-models
		const resolvedRoot = modelRoot && existsSync(modelRoot)
			? modelRoot
			: join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "live2d-voice-models");

		// 模型归类在 imported/ 分类下
		const importedGroupDir = join(resolvedRoot, "imported");
		if (!existsSync(importedGroupDir)) {
			mkdirSync(importedGroupDir, { recursive: true });
		}

		// 计算模型安全目录名
		const baseFromZip = basename(originalFilename, ".zip");
		const baseFromSettings = detected.file.replace(/\.model3\.json$/i, "").replace(/\.json$/i, "");
		const folderName = sanitizeModelFolderName(baseFromZip && baseFromZip !== "download" ? baseFromZip : baseFromSettings);
		const targetDir = join(importedGroupDir, folderName);

		// 如果目标目录已存在，先清理旧内容，实现安全覆盖
		if (existsSync(targetDir)) {
			rmSync(targetDir, { recursive: true, force: true });
		}
		mkdirSync(targetDir, { recursive: true });

		// 5. 复制模型文件夹内所有文件到目标目录
		cpSync(detected.dir, targetDir, { recursive: true });

		return {
			ok: true,
			name: folderName,
			label: folderName,
			kind: detected.kind,
			group: "imported",
		};
	} finally {
		// 清理 staging 目录
		try {
			if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
		} catch {}
	}
}
