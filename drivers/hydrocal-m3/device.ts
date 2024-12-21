'use strict';

import EventSource from 'eventsource';
import Homey from 'homey';

interface PreviousMeters {
  // yesterday date
  date: Date;
  // #region values from yesterday
  // eslint-disable-next-line camelcase
  meter_cooling: number;
  // eslint-disable-next-line camelcase
  meter_heating: number;
  // eslint-disable-next-line camelcase
  meter_water_cold: number;
  // eslint-disable-next-line camelcase
  meter_water_warm: number;
  // #endregion
}

module.exports = class HydrocalM3Driver extends Homey.Device {

  private eventSource?: EventSource;

  private previousMetersKey = 'previousMetersKey';

  private previousMeters?: PreviousMeters;

  private msInTwoDays: number = 24 * 60 * 60 * 1000 * 2;

  /** Set time to 00:00:00 */
  getDateWithoutTime(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Get the yesterday without the time */
  getYesterday(): Date {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Set time to 00:00:00 and return
    return this.getDateWithoutTime(yesterday);
  }

  async resetPreviousMetersAsync() {
    this.log('Reset previous meters.');
    this.previousMeters = {
      date: this.getYesterday(),
      meter_cooling: 0,
      meter_heating: 0,
      meter_water_cold: 0,
      meter_water_warm: 0,
    };
    await this.setStoreValue(this.previousMetersKey, this.previousMeters);
  }

  updateDailyCapabilities() {
    if (!this.previousMeters?.date) return;
    this.updateDailyCapability('meter_cooling');
    this.updateDailyCapability('meter_heating');
    this.updateDailyCapability('meter_water_cold');
    this.updateDailyCapability('meter_water_warm');
  }

  updateDailyCapability(capabilityId: keyof PreviousMeters) {
    if (!this.previousMeters || !(capabilityId in this.previousMeters)) {
      return; // Exit if previousDate is null/undefined or capabilityId is not a key
    }
    const currentValue = this.getCapabilityValue(capabilityId);
    let previousValue = this.previousMeters?.[capabilityId];
    if (typeof previousValue !== 'number') {
      return; // Exit if the value is not a number
    }
    this.log(`updateDailyCapability ${capabilityId} previous value:`, previousValue);
    let dailyValue = previousValue === 0
      ? 0
      : currentValue - previousValue;
    // fix unit of measure in case of water
    // (meter works in m3, but the daily is calculated in liters)
    if (capabilityId === 'meter_water_cold'
      || capabilityId === 'meter_water_warm') {
      dailyValue *= 1000;
    }
    if (previousValue === 0) {
      previousValue = dailyValue;
      if (capabilityId === 'meter_cooling'
        || capabilityId === 'meter_heating'
        || capabilityId === 'meter_water_cold'
        || capabilityId === 'meter_water_warm'
      ) {
        this.previousMeters[capabilityId] = previousValue;
      }
      this.setStoreValue(this.previousMetersKey, this.previousMeters)
        .catch((error) => this.log('Failed to store previous meter data:', error));
    }
    const dailyCapabilityId = `${capabilityId}_daily`;
    this.setCapabilityValueAndLog(dailyCapabilityId, dailyValue);
  }

  setCapabilityValueAndLog(capabilityId: string, value: unknown) {
    this.setCapabilityValue(capabilityId, value)
      .then(() => this.log(`${capabilityId} capability value updated successfully:`, value))
      .catch((error) => this.log(`Error updating ${capabilityId} capability value:`, error));
  }

  /** Checks the date of the previous meters
   * if the date is more than 1 day, then reset its values
  */
  async checkPreviousMetersAsync() {
    if (!this.previousMeters?.date) return;
    const today = this.getDateWithoutTime(new Date(Date.now()));
    const diffInMs = Math.abs(today.getTime() - new Date(this.previousMeters.date).getTime());
    if (diffInMs > this.msInTwoDays) {
      // the last measurement is too old
      // update daily capabilities
      this.updateDailyCapabilities();
      // reset values
      await this.resetPreviousMetersAsync();
    }
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('Hydrocal M3 device is initializing...');
    try {
      // #region storage for daily usages
      this.previousMeters = this.getStoreValue(this.previousMetersKey);
      if (!this.previousMeters) {
        // initialize with default values
        await this.resetPreviousMetersAsync();
      }
      this.log(this.previousMeters);
      // #endregion
      this.eventSource = new EventSource('http://192.168.0.39/events');

      //  this.log(this.eventSource);

      this.eventSource.onopen = () => {
        this.log('eventsource opened');
        // this.log(this.eventSource);
      };

      // Listen for generic messages
      // this.eventSource.onmessage = (event) => {
      //   this.log('eventsource message arrived.');
      //   this.log('Received message:', event.data); // Should log any 'data' event
      // };

      this.eventSource.addEventListener('state', (event) => {
        // this.log('eventsource addEventListener: state message arrived:', event.data);
        const parsedMsg = JSON.parse(event.data) as StateMessage;

        this.checkPreviousMetersAsync()
          .catch((error) => this.log('Error checking previous meters:', error));

        if (parsedMsg.id === 'sensor-cold_water__m3_') {
          this.setCapabilityValueAndLog('meter_water_cold', parsedMsg.value);
          this.updateDailyCapability('meter_water_cold');
        } else if (parsedMsg.id === 'sensor-warm_water__m3_') {
          this.setCapabilityValueAndLog('meter_water_warm', parsedMsg.value);
          this.updateDailyCapability('meter_water_warm');
        } else if (parsedMsg.id === 'sensor-heating__kwh_') {
          this.setCapabilityValueAndLog('meter_heating', parsedMsg.value);
          this.updateDailyCapability('meter_heating');
        } else if (parsedMsg.id === 'sensor-cooling__kwh_') {
          this.setCapabilityValueAndLog('meter_cooling', parsedMsg.value);
          this.updateDailyCapability('meter_cooling');
        } else if (parsedMsg.id === 'sensor-supply_temperature__c_') {
          this.setCapabilityValueAndLog('measure_temperature_supply', parsedMsg.value);
        } else if (parsedMsg.id === 'sensor-return_temperature__c_') {
          this.setCapabilityValueAndLog('measure_temperature_return', parsedMsg.value);
        } else if (parsedMsg.id === 'sensor-wifi_signal_db') {
          this.setCapabilityValueAndLog('measure_signal_strength', parsedMsg.value);
        } else {
          this.log(`State event received: id: ${parsedMsg.id} value: ${parsedMsg.state} (${parsedMsg.value})`);
        }

        if (parsedMsg.id === 'sensor-supply_temperature__c_' || parsedMsg.id === 'sensor-return_temperature__c_') {
          const tempSupply = Number.parseFloat(this.getCapabilityValue('measure_temperature_supply'));
          const tempReturn = Number.parseFloat(this.getCapabilityValue('measure_temperature_return'));
          const tempDiff = parseFloat((tempSupply - tempReturn).toFixed(1));
          // this.log({ tempSupply, tempReturn, tempDiff });
          this.setCapabilityValueAndLog('measure_temperature_delta', tempDiff);
        }
      });

      this.eventSource.onmessage = (event) => {
        this.log('eventsource message arrived.');
      };

      this.eventSource.onerror = (error: unknown) => {
        this.log('EventSource error:', error);
      };

      this.log('Hydrocal M3 device has been initialized');
    } catch (error) {
      this.log('Hydrocal M3 device failed during initialization:', error);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Hydrocal M3 device has been added');
  }

  async onUninit() {
    this.log('HydrocalM3 device is uninitializing...');
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.log('HydrocalM3 device has been uninitialized');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('HydrocalM3 device settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('HydrocalM3 device was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('HydrocalM3 device has been deleted');
  }

};
