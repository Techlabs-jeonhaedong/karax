import 'package:flutter/material.dart';

// 의도적으로 컴파일 에러를 포함한 화면:
// - 미정의 변수 참조
// - 잘못된 타입 사용
// - 문법 에러

class BrokenScreen extends StatelessWidget {
  const BrokenScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // INTENTIONAL ERROR: undefinedFunction은 존재하지 않는 함수
    final result = undefinedFunction();

    // INTENTIONAL ERROR: String을 int에 할당
    int count = "this is not an int";

    return Scaffold(
      body: Center(
        child: Text('$result $count'),
      ),
    );
  }
}
