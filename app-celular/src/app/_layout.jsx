// Configuracion de expo-router: el stack de pantallas de la app.
// Importar datos y hacer import.js evita que el transform se queje en algunos
// entornos; aqui solo declaramos las rutas.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { UbicacionProvider } from '../hooks/useUbicacion';

export default function Layout() {
  return (
    <UbicacionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1F4E79' },
          headerTintColor: '#fff',
          headerTitleAlign: 'center',
          contentStyle: { backgroundColor: '#fff' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Mapa de la FES' }} />
        <Stack.Screen name="buscar" options={{ title: 'Puntos cercanos' }} />
        <Stack.Screen name="navegar" options={{ title: 'Navegación por voz' }} />
        <Stack.Screen name="brujula" options={{ title: 'Brújula' }} />
      </Stack>
    </UbicacionProvider>
  );
}