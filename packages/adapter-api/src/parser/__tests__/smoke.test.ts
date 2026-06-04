import { describe, expect, it } from "vitest";
import { parseSource } from "../loader.js";

/**
 * M0 완료 조건 — 4개 언어 전부 스모크 테스트 통과.
 * 각 hello-world 스니펫을 실제로 파싱해 루트 노드가 존재하는지 확인한다.
 */

describe("tree-sitter 그래머 스모크 테스트", () => {
  it(
    "Dart — hello world 파싱 시 루트 노드 반환",
    async () => {
      const source = `
void main() {
  print('Hello, World!');
}
`;
      const root = await parseSource("dart", source);
      expect(root).toBeDefined();
      expect(root.type).toBeTruthy();
      expect(root.childCount).toBeGreaterThan(0);
    },
    15_000
  );

  it(
    "TypeScript — hello world 파싱 시 루트 노드 반환",
    async () => {
      const source = `
const greeting: string = "Hello, World!";
console.log(greeting);
`;
      const root = await parseSource("typescript", source);
      expect(root).toBeDefined();
      expect(root.type).toBeTruthy();
      expect(root.childCount).toBeGreaterThan(0);
    },
    15_000
  );

  it(
    "Swift — hello world 파싱 시 루트 노드 반환",
    async () => {
      const source = `
import Foundation

let greeting = "Hello, World!"
print(greeting)
`;
      const root = await parseSource("swift", source);
      expect(root).toBeDefined();
      expect(root.type).toBeTruthy();
      expect(root.childCount).toBeGreaterThan(0);
    },
    15_000
  );

  it(
    "Kotlin — hello world 파싱 시 루트 노드 반환",
    async () => {
      const source = `
fun main() {
    println("Hello, World!")
}
`;
      const root = await parseSource("kotlin", source);
      expect(root).toBeDefined();
      expect(root.type).toBeTruthy();
      expect(root.childCount).toBeGreaterThan(0);
    },
    15_000
  );

  it(
    "Dart — 복잡한 Flutter 위젯 파싱",
    async () => {
      const source = `
import 'package:flutter/material.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: Center(child: const Text('Hello Flutter!')),
    );
  }
}
`;
      const root = await parseSource("dart", source);
      expect(root.type).toBe("program");
      expect(root.hasError).toBe(false);
    },
    15_000
  );

  it(
    "TSX — React Native 컴포넌트 파싱 (JSX 포함)",
    async () => {
      const source = `
import React from 'react';
import { View, Text } from 'react-native';

const HomeScreen: React.FC = () => {
  return (
    <View>
      <Text>Hello React Native!</Text>
    </View>
  );
};

export default HomeScreen;
`;
      // JSX가 포함된 소스는 tsx 그래머로 파싱해야 한다
      const root = await parseSource("tsx", source);
      expect(root.type).toBeTruthy();
      expect(root.hasError).toBe(false);
    },
    15_000
  );
});
