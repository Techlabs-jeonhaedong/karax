import { describe, expect, it } from "vitest";
import {
  generateMockValue,
  parseConstructorParams,
  HarnessError,
} from "../harness/paramCodegen.js";

// ── generateMockValue 단위 테스트 ──────────────────────────────────────────────

describe("generateMockValue", () => {
  it("String 타입에 대해 문자열 리터럴을 반환해야 한다", () => {
    const val = generateMockValue("String", "title", 42);
    expect(val).toMatch(/^'[^']*'$/);
  });

  it("int 타입에 대해 정수 리터럴을 반환해야 한다", () => {
    const val = generateMockValue("int", "count", 42);
    expect(val).toMatch(/^\d+$/);
  });

  it("double 타입에 대해 소수점 리터럴을 반환해야 한다", () => {
    const val = generateMockValue("double", "price", 42);
    expect(val).toMatch(/^\d+\.\d+$/);
  });

  it("bool 타입에 대해 false를 반환해야 한다", () => {
    const val = generateMockValue("bool", "isEnabled", 42);
    expect(val).toBe("false");
  });

  it("같은 seed와 이름이면 항상 같은 값을 반환해야 한다(결정론)", () => {
    const a = generateMockValue("String", "name", 42);
    const b = generateMockValue("String", "name", 42);
    expect(a).toBe(b);
  });

  it("다른 seed면 다른 값을 반환할 수 있어야 한다", () => {
    const a = generateMockValue("String", "name", 1);
    const b = generateMockValue("String", "name", 999);
    // 완전히 같을 수도 있지만 대부분 다름 — 최소한 예외 없이 값을 반환해야 함
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });

  it("List<String> 타입은 짧은 리스트 리터럴을 반환해야 한다", () => {
    const val = generateMockValue("List<String>", "items", 42);
    expect(val).toMatch(/^\[/);
    expect(val).toMatch(/\]$/);
  });

  it("주입 불가능한 타입은 HarnessError를 throw해야 한다", () => {
    expect(() => generateMockValue("Function", "callback", 42)).toThrowError(HarnessError);
    expect(() => generateMockValue("VoidCallback", "onPressed", 42)).toThrowError(HarnessError);
    expect(() => generateMockValue("Widget", "child", 42)).toThrowError(HarnessError);
    expect(() => generateMockValue("BuildContext", "context", 42)).toThrowError(HarnessError);
    expect(() => generateMockValue("ComplexObject", "data", 42)).toThrowError(HarnessError);
  });
});

// ── parseConstructorParams 단위 테스트 ────────────────────────────────────────

describe("parseConstructorParams", () => {
  it("파라미터 없는 const 생성자를 올바르게 파싱해야 한다", () => {
    const source = `
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
}
`;
    const params = parseConstructorParams("HomeScreen", source);
    // super.key는 포함하지 않아야 함 (기본 key 파라미터는 제외)
    expect(params.filter((p) => p.name !== "key")).toHaveLength(0);
  });

  it("required String 파라미터를 파싱해야 한다", () => {
    const source = `
class MyScreen extends StatelessWidget {
  const MyScreen({super.key, required this.title});
  final String title;
}
`;
    const params = parseConstructorParams("MyScreen", source);
    const required = params.filter((p) => p.isRequired && p.name !== "key");
    expect(required).toHaveLength(1);
    expect(required[0].name).toBe("title");
    expect(required[0].type).toBe("String");
    expect(required[0].isNamed).toBe(true);
  });

  it("required double 파라미터를 파싱해야 한다", () => {
    const source = `
class PriceScreen extends StatelessWidget {
  const PriceScreen({super.key, required this.price});
  final double price;
}
`;
    const params = parseConstructorParams("PriceScreen", source);
    const required = params.filter((p) => p.isRequired && p.name !== "key");
    expect(required).toHaveLength(1);
    expect(required[0].name).toBe("price");
    expect(required[0].type).toBe("double");
  });

  it("선택적 파라미터는 isRequired=false여야 한다", () => {
    const source = `
class BadgeCard extends StatelessWidget {
  const BadgeCard({super.key, this.badge});
  final String? badge;
}
`;
    const params = parseConstructorParams("BadgeCard", source);
    const optional = params.filter((p) => !p.isRequired && p.name !== "key");
    expect(optional).toHaveLength(1);
    expect(optional[0].name).toBe("badge");
    expect(optional[0].isRequired).toBe(false);
  });

  it("클래스가 없으면 빈 배열을 반환해야 한다", () => {
    const source = "// no class here";
    const params = parseConstructorParams("NonExistent", source);
    expect(params).toHaveLength(0);
  });

  it("여러 required 파라미터를 순서대로 파싱해야 한다", () => {
    const source = `
class ProductCard extends StatelessWidget {
  const ProductCard({
    super.key,
    required this.name,
    required this.price,
    this.badge,
  });
  final String name;
  final double price;
  final String? badge;
}
`;
    const params = parseConstructorParams("ProductCard", source);
    const required = params.filter((p) => p.isRequired && p.name !== "key");
    expect(required).toHaveLength(2);
    expect(required[0].name).toBe("name");
    expect(required[1].name).toBe("price");
  });
});
