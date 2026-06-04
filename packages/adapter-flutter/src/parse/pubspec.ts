import { readFile } from "fs/promises";
import path from "path";

/**
 * pubspec.yaml에서 패키지명(name 필드)을 읽는다.
 * YAML 파서 의존성 없이 정규식으로 처리한다.
 */
export async function readPackageName(projectPath: string): Promise<string> {
  const pubspecPath = path.join(projectPath, "pubspec.yaml");
  const content = await readFile(pubspecPath, "utf-8");
  const match = content.match(/^name:\s*(\S+)/m);
  if (!match) throw new Error(`pubspec.yaml에서 name 필드를 찾을 수 없음: ${pubspecPath}`);
  return match[1];
}

/**
 * pubspec.yaml이 flutter 의존성을 가지는지 확인한다.
 */
export async function hasFlutterDependency(projectPath: string): Promise<boolean> {
  const pubspecPath = path.join(projectPath, "pubspec.yaml");
  try {
    const content = await readFile(pubspecPath, "utf-8");
    return /^\s+flutter:\s*$/m.test(content) || /flutter:\s*\n\s+sdk:\s*flutter/m.test(content);
  } catch {
    return false;
  }
}
