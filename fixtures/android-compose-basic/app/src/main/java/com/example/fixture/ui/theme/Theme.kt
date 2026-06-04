package com.example.fixture.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ---------------------------------------------------------------------------
// Design tokens — explicit color definitions (mirrors colors.xml values)
// SettingsScreen and other screens MUST reference MaterialTheme.colorScheme,
// never hardcoded Color(...) literals.
// ---------------------------------------------------------------------------

private val BrandPrimary = Color(0xFF6200EE)
private val BrandPrimaryVariant = Color(0xFF3700B3)
private val BrandSecondary = Color(0xFF03DAC5)
private val BrandSecondaryVariant = Color(0xFF018786)
private val ErrorRed = Color(0xFFB00020)

private val SurfaceLight = Color(0xFFFFFFFF)
private val SurfaceVariantLight = Color(0xFFE7E0EC)
private val BackgroundLight = Color(0xFFFEF7FF)
private val OnPrimary = Color(0xFFFFFFFF)
private val OnSecondary = Color(0xFF000000)
private val OnSurface = Color(0xFF1C1B1F)
private val OnSurfaceVariant = Color(0xFF49454F)
private val OnBackground = Color(0xFF1C1B1F)

val FixtureLightColorScheme = lightColorScheme(
    primary = BrandPrimary,
    onPrimary = OnPrimary,
    primaryContainer = BrandPrimaryVariant,
    onPrimaryContainer = OnPrimary,
    secondary = BrandSecondary,
    onSecondary = OnSecondary,
    secondaryContainer = BrandSecondaryVariant,
    onSecondaryContainer = OnSecondary,
    tertiary = Color(0xFF7857A8),
    onTertiary = Color(0xFFFFFFFF),
    error = ErrorRed,
    onError = Color(0xFFFFFFFF),
    background = BackgroundLight,
    onBackground = OnBackground,
    surface = SurfaceLight,
    onSurface = OnSurface,
    surfaceVariant = SurfaceVariantLight,
    onSurfaceVariant = OnSurfaceVariant,
    outline = Color(0xFF79747E),
)

private val FixtureDarkColorScheme = darkColorScheme(
    primary = Color(0xFFD0BCFF),
    onPrimary = Color(0xFF381E72),
    primaryContainer = Color(0xFF4F378B),
    onPrimaryContainer = Color(0xFFEADDFF),
    secondary = Color(0xFFCCC2DC),
    onSecondary = Color(0xFF332D41),
    secondaryContainer = Color(0xFF4A4458),
    onSecondaryContainer = Color(0xFFE8DEF8),
    background = Color(0xFF1C1B1F),
    onBackground = Color(0xFFE6E1E5),
    surface = Color(0xFF1C1B1F),
    onSurface = Color(0xFFE6E1E5),
    surfaceVariant = Color(0xFF49454F),
    onSurfaceVariant = Color(0xFFCAC4D0),
    error = Color(0xFFF2B8B8),
    onError = Color(0xFF601410),
)

@Composable
fun FixtureAppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) FixtureDarkColorScheme else FixtureLightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography(),
        content = content
    )
}
