package com.example.fixture.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * PriceTag — 가장 안쪽 커스텀 컴포넌트 (depth 2).
 *
 * ProductCard 내부에서 사용되며, 2단 깊이 인라이닝 검증을 위해
 * 의도적으로 별도 파일에 분리했다.
 *
 * SettingsScreen 처럼 테마 시스템을 직접 참조하는 대신,
 * 여기서는 파라미터로 받은 색상을 사용해 어댑터가 파라미터 전달을 올바르게 추적하는지 검증한다.
 */
@Composable
fun PriceTag(
    price: String,
    modifier: Modifier = Modifier,
    backgroundColor: Color = Color(0xFFEEF2FF),
    textColor: Color = Color(0xFF3D5AFE),
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(backgroundColor)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = price,
            color = textColor,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.5.sp,
        )
    }
}
