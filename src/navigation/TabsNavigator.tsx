import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import CreatorScreen from "../screens/Creator/CreatorScreen";
import HomeScreen from "../screens/Home/HomeScreen";
import SettingsScreen from "../screens/Settings/SettingsScreen";

export type TabsParamList = {
  Home: undefined;
  Creator: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabsParamList>();

function TabsNavigator() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Creator" component={CreatorScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default TabsNavigator;
