# grammars/

이 디렉토리에는 tree-sitter wasm 그래머 파일이 빌드 타임에 복사된다.

## 출처

`tree-sitter-wasms` npm 패키지 (v0.1.13) 에서 제공하는 prebuilt wasm 파일을 사용한다.

- **패키지**: https://www.npmjs.com/package/tree-sitter-wasms
- **라이선스**: MIT
- **포함 그래머**:
  - `tree-sitter-dart.wasm` — Dart (Flutter)
  - `tree-sitter-typescript.wasm` — TypeScript/TSX (React Native)
  - `tree-sitter-swift.wasm` — Swift (iOS)
  - `tree-sitter-kotlin.wasm` — Kotlin (Android)

## 빌드 시 복사 방법

패키지 설치 후 다음 경로에서 wasm 파일을 가져온다:
```
node_modules/tree-sitter-wasms/out/*.wasm
```

postinstall 스크립트 또는 런타임 로더가 자동으로 처리한다.

## .gitignore

*.wasm 파일은 용량 문제로 git에서 제외한다.
설치 후 node_modules에서 참조하거나, postinstall로 복사한다.
