package com.example.fixture

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.example.fixture.ui.theme.FixtureAppTheme

/**
 * MainActivity — 앱 진입점.
 *
 * - AndroidManifest.xml에 LAUNCHER intent-filter로 선언됨
 * - setContent { AppNavHost() } 패턴으로 Compose 루트 진입
 * - [FixtureAppTheme]으로 MaterialTheme 색상 토큰 주입
 *
 * 어댑터 발견 경로:
 * AndroidManifest.xml Activity 태그 → MainActivity.kt → setContent → AppNavHost() → NavHost
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            FixtureAppTheme {
                AppNavHost()
            }
        }
    }
}
