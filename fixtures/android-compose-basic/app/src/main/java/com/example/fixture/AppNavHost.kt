package com.example.fixture

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.example.fixture.screens.DetailScreen
import com.example.fixture.screens.HomeScreen
import com.example.fixture.screens.ListScreen
import com.example.fixture.screens.SettingsScreen

/**
 * AppNavHost — androidx.navigation.compose 기반 네비게이션 그래프.
 *
 * 라우트 정의:
 * - "home"     → [HomeScreen]       (startDestination)
 * - "detail"   → [DetailScreen]
 * - "list"     → [ListScreen]
 * - "settings" → [SettingsScreen]
 *
 * 의도적으로 [OrphanScreen]은 여기에 포함하지 않는다.
 * 어댑터의 heuristic 발견 경로를 검증하기 위함이다.
 *
 * 네비게이션:
 * - Home → Detail  (Explore Products 버튼)
 * - Home → List    (Browse All Items 버튼)
 * - Home → Settings (Settings 버튼)
 * - Detail → Home  (뒤로가기)
 * - List → Home    (뒤로가기)
 * - Settings → Home (뒤로가기)
 */
@Composable
fun AppNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
) {
    NavHost(
        navController = navController,
        startDestination = AppRoutes.HOME,
        modifier = modifier,
    ) {
        composable(route = AppRoutes.HOME) {
            HomeScreen(
                onExploreClick = { navController.navigate(AppRoutes.DETAIL) },
                onListClick = { navController.navigate(AppRoutes.LIST) },
                onSettingsClick = { navController.navigate(AppRoutes.SETTINGS) },
            )
        }

        composable(route = AppRoutes.DETAIL) {
            DetailScreen(
                onBackClick = { navController.popBackStack() },
            )
        }

        composable(route = AppRoutes.LIST) {
            ListScreen(
                onBackClick = { navController.popBackStack() },
            )
        }

        composable(route = AppRoutes.SETTINGS) {
            SettingsScreen(
                onBackClick = { navController.popBackStack() },
            )
        }
    }
}

/**
 * 라우트 상수 — 문자열 리터럴 중복 방지.
 */
object AppRoutes {
    const val HOME = "home"
    const val DETAIL = "detail"
    const val LIST = "list"
    const val SETTINGS = "settings"
    // NOTE: "orphan"은 의도적으로 없음 — OrphanScreen은 NavHost에 등록하지 않는다.
}
