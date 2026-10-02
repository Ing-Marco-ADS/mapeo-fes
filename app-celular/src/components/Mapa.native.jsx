// Componente de mapa para iOS/Android: usa react-native-maps.
import { View, StyleSheet } from 'react-native';
import MapView, { Marker, UrlTile, Circle } from 'react-native-maps';

const CENTRO = {
  latitude: 19.4752,
  longitude: -99.046,
  latitudeDelta: 0.0035,
  longitudeDelta: 0.0035,
};

export default function Mapa({ puntos, ubica, alSeleccionarPunto }) {
  return (
    <View style={styles.contenedor}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={CENTRO}
        showsCompass={true}
        showsUserLocation={false}
      >
        {/* Azulejos de OpenStreetMap */}
        <UrlTile
          urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
        />

        {/* Circulo de precision del GPS */}
        {ubica && ubica.precision && (
          <Circle
            center={{ latitude: ubica.lat, longitude: ubica.lng }}
            radius={ubica.precision || 10}
            fillColor="rgba(37,99,235,0.12)"
            strokeColor="rgba(37,99,235,0.4)"
          />
        )}

        {/* Marcador de mi ubicacion */}
        {ubica && (
          <Marker
            coordinate={{ latitude: ubica.lat, longitude: ubica.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Tu ubicación"
          >
            <View style={styles.miPosicion}>
              <View style={styles.miPosicionNucleo} />
            </View>
          </Marker>
        )}

        {/* Puntos de interes del mapeo */}
        {puntos.map(p => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            pinColor={p.color}
            title={p.nombre}
            description={p.tipoNombre}
            onPress={() => alSeleccionarPunto?.(p)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  miPosicion: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(37,99,235,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2563eb',
  },
  miPosicionNucleo: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
});