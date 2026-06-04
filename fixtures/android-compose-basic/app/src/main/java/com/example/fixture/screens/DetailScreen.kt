package com.example.fixture.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.fixture.R
import com.example.fixture.components.ProductCard

/**
 * DetailScreen — 커스텀 컴포넌트 합성 아키타입.
 *
 * 검증 포인트:
 * - [ProductCard] 커스텀 컴포넌트를 3회 반복 사용
 * - [ProductCard] 내부에 [PriceTag] 가 포함돼 있어 2단 깊이 인라이닝 발생
 * - 각 카드는 서로 다른 데이터(이름/설명/가격/배지)를 받아 다양성 보장
 *
 * 네비게이션: 뒤로가기 → Home
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.detail_title),
                        fontWeight = FontWeight.Bold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = MaterialTheme.colorScheme.onPrimary,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    navigationIconContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            )
        },
        modifier = modifier,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.detail_subtitle),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(4.dp))

            // ProductCard × 3 — 2단 깊이 커스텀 컴포넌트 인라이닝 검증
            ProductCard(
                productName = stringResource(R.string.product_alpha_name),
                description = stringResource(R.string.product_alpha_desc),
                price = "$29.99",
                badge = "BESTSELLER",
            )

            ProductCard(
                productName = stringResource(R.string.product_beta_name),
                description = stringResource(R.string.product_beta_desc),
                price = "$14.99",
                badge = "NEW",
            )

            ProductCard(
                productName = stringResource(R.string.product_gamma_name),
                description = stringResource(R.string.product_gamma_desc),
                price = "$49.99",
                badge = null,
            )
        }
    }
}
