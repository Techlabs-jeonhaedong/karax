/**
 * Branch 노드를 variant별로 펼치는 유틸리티 (PLAN.md 4절, M9d)
 *
 * Branch 노드: children 배열의 각 arm이 조건 분기(if/else/when의 각 경우)를 나타낸다.
 * 기본 렌더는 첫 번째 arm(index 0)만 사용하고, expandVariants를 사용하면
 * 각 arm을 별도 IRDocument로 펼쳐 variant 스크린샷을 생성할 수 있다.
 *
 * - Tier 2 전용: Tier 1(compile)은 첫 분기 고정
 * - 화면당 최대 5 variant
 * - 첫 번째 variant 라벨은 "default"
 */

import type { IRDocument, IRNode } from "./schema.js";

export interface VariantDoc {
  /** variant 식별자 — 스크린샷 파일명에 사용: <screenId>__<label>.png */
  label: string;
  doc: IRDocument;
}

/**
 * doc 내 Branch 노드를 탐색해 각 arm별로 IRDocument를 생성한다.
 *
 * Branch가 없으면 빈 배열을 반환한다 (default 문서는 포함하지 않음).
 * 호출자가 원래 doc + expandVariants 결과를 합쳐 전체 variant 셋을 구성한다.
 *
 * 최대 5개 variant (PLAN.md 4절).
 */
export function expandVariants(doc: IRDocument): VariantDoc[] {
  // Branch 노드를 BFS로 찾는다 — 첫 번째 발견된 Branch만 처리
  const branchInfo = findFirstBranch(doc.screen.root);
  if (!branchInfo) return [];

  const { branch, pathToParent } = branchInfo;
  const arms = branch.children ?? [];

  if (arms.length <= 1) return [];

  // arms[0]는 "default"이므로 arms[1]부터 variant
  // 전체 arms 중 최대 5개 (index 0 포함): variant는 index 1~4
  const maxVariants = 5;
  const variantArms = arms.slice(1, maxVariants); // arms[1] ~ arms[min(4, length-1)]

  return variantArms.map((arm, idx) => {
    const label = `arm${idx + 1}`; // arm1, arm2, ...
    const newDoc = replaceBranchWithArm(doc, pathToParent, arm);
    return { label, doc: newDoc };
  });
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

interface BranchInfo {
  branch: IRNode;
  /** Branch 노드를 포함하는 부모 경로 정보 (교체에 사용) */
  pathToParent: NodePath;
}

/**
 * 부모 배열 내 인덱스 정보를 담은 경로.
 * pathToParent[i] = { node, childIndex } 를 순서대로 따라가면 Branch에 도달한다.
 */
type NodePath = Array<{ node: IRNode; childIndex: number }>;

function findFirstBranch(root: IRNode): BranchInfo | null {
  // BFS
  interface QueueItem {
    node: IRNode;
    path: NodePath;
  }

  const queue: QueueItem[] = [{ node: root, path: [] }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { node, path } = item;

    if (node.type === "Branch") {
      return { branch: node, pathToParent: path };
    }

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        queue.push({
          node: node.children[i],
          path: [...path, { node, childIndex: i }],
        });
      }
    }
  }

  return null;
}

/**
 * Branch 노드를 지정한 arm 노드로 교체한 새 IRDocument를 반환한다.
 * 원본 doc는 불변 유지.
 */
function replaceBranchWithArm(
  doc: IRDocument,
  path: NodePath,
  arm: IRNode
): IRDocument {
  const newRoot = replaceNodeAtPath(doc.screen.root, path, arm);

  return {
    ...doc,
    screen: {
      ...doc.screen,
      root: newRoot,
    },
    diagnostics: [
      ...(doc.diagnostics ?? []),
      {
        level: "info" as const,
        code: "BRANCH_VARIANT_EXPANDED",
        message: `Branch variant expanded: arm replaced`,
      },
    ],
  };
}

/**
 * path를 따라가면서 Branch 위치를 arm으로 교체한 새 노드 트리를 반환한다.
 */
function replaceNodeAtPath(
  node: IRNode,
  path: NodePath,
  replacement: IRNode
): IRNode {
  if (path.length === 0) {
    // 이 노드 자체가 Branch — 교체
    return replacement;
  }

  const [head, ...tail] = path;
  // head.node === node이고 head.childIndex가 다음에 내려갈 자식 인덱스
  const children = node.children ? [...node.children] : [];

  if (tail.length === 0) {
    // 다음 자식이 Branch — 교체
    children[head.childIndex] = replacement;
  } else {
    // 더 깊이 내려간다
    children[head.childIndex] = replaceNodeAtPath(
      children[head.childIndex],
      tail,
      replacement
    );
  }

  return { ...node, children };
}
