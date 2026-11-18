import { useRouter } from 'expo-router';
import { WaiverSigning } from '../src/features/waivers/WaiverSigning';

/** Sign the club's waivers again: a booking came back waiver_required. */
export default function WaiversRoute() {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));
  return <WaiverSigning mode="renew" onDone={back} secondary={{ label: 'Back', onPress: back }} />;
}
