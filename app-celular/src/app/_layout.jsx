// Configuracion de expo-router: el stack de pantallas de la app.
// Un encabezado azul oscuro, sin sombra y con el titulo centrado mantiene
// todas las pantallas con la misma identidad visual.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { UbicacionProvider } from '../hooks/useUbicacion';
import { C } from '../lib/tema';

export default function Layout() {
  return (
    <UbicacionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.navy },
          headerTintColor: C.blanco,
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '800', fontSize: 17 },
          contentStyle: { backgroundColor: C.fondo },
        }}
      >
        {/* La pantalla principal dibuja su propia tarjeta superior */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="buscar" options={{ title: 'Buscar' }} />
        <Stack.Screen name="navegar" options={{ title: 'Navegación por voz' }} />
        <Stack.Screen name="brujula" options={{ title: 'Brújula' }} />
      </Stack>
    </UbicacionProvider>
  );
}
