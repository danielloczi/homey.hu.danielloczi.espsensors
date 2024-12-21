'use strict';

import Homey from 'homey';

module.exports = class HydrocalM3Driver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Hydrocal M3 driver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [
      // Example device data, note that `store` is optional
      {
        name: 'Hydrocal M3',
        data: {
          id: 'hydrocalm3-device',
        },
        store: {
          address: '192.168.0.39',
        },
      },
    ];
  }

};
