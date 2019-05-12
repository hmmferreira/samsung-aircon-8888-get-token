
require('@babel/polyfill')
import callbackify from "./util/callbackify"
import { exec } from 'child_process'
import {
	HbActiveEnum,
	HbSwingModeEnum,
	HbTargetHeaterCoolerStateEnum,
	HbCurrentHeaterCoolerStateEnum,
	HbFilterChangeIndicationEnum,
	HomebridgeHapExtendedCharacteristic,
} from './types/homebridge'
import {
	EnumValueLiterals,
	JsonType,
} from './types/generic'

import {
	AirconMode,
	AirconModeOption,
	SamsungAirconConfig,
	Wind,
	Swing,
	OnOff,
} from './types/ss-aircon'

let Service: HAPNodeJS.Service
let Characteristic: HomebridgeHapExtendedCharacteristic
let	Accessory: HAPNodeJS.Accessory
class SamsungAircon {
	aircon: HAPNodeJS.Service
	airconFilter: HAPNodeJS.Service
	infoService: HAPNodeJS.Service
	log: (...args: any[]) => void
	name: string
	ip: string
	token: string
	userAllowedMode: 'heat' | 'cool' | 'both'
	patchCert: string
	accessoryName: string
	response: string
	curlGetPartials: string[]
	curSetPartials: (request: JsonType, append: string) => string[]
	constructor(
		log: (...args: any) => void,
		config: SamsungAirconConfig,
	) {
		const { name, ip, token, patchCert, userAllowedMode = 'both' } = config
		this.log = log
		this.name = name
		this.ip = ip
		this.token = token
		this.patchCert = patchCert
		this.accessoryName = name
		this.userAllowedMode = ['heat', 'cool', 'both'].includes(userAllowedMode.toLowerCase())
			? userAllowedMode.toLowerCase() as 'heat' | 'cool' | 'both'
			: 'both'
		this.response = ''
		this.curlGetPartials = [
			'curl -s -k',
			'-H "Content-Type: application/json"',
			`-H "Authorization: Bearer ${token}"`,
			`--cert ${patchCert}`,
			`--insecure -X GET`,
			`https://${ip}:8888/devices|jq`,
		]
		this.curSetPartials = (request: JsonType, append: string) => [
			'curl -k',
			'-H "Content-Type: application/json"',
			`-H "Authorization: Bearer ${token}"`,
			`--cert ${patchCert}`,
			'--insecure -X PUT -d',
			`\'${JSON.stringify(request)}\'`,
			!!append
				? `https://${ip}:8888/devices/0/` + append
				: `https://${ip}:8888/devices/0`,
		]

		log('Constructor Samsung Aircon...')
		// @ts-ignore
		this.aircon = new Service.HeaterCooler(this.name)
		// @ts-ignore
		this.airconFilter = new Service.FilterMaintenance(this.name + ' Filter')
		// @ts-ignore
		this.infoService = new Service.AccessoryInformation()

		// On or Off
		this.aircon
		.getCharacteristic(Characteristic.Active)
		.on('get', callbackify(this.getActive))
		.on('set', callbackify(this.setActive))

		this.aircon
		.getCharacteristic(Characteristic.CurrentTemperature)
		.setProps({
			minValue: -100,
			maxValue: 100,
			minStep: 0.01,
		} as HAPNodeJS.CharacteristicProps)
		.on('get', callbackify(this.getCurrentTemperature))

		const targetHeaterCoolerStateProp = (() => {
			const char = Characteristic.TargetHeaterCoolerState
			const { HEAT, COOL, AUTO } = char
			if (this.userAllowedMode === 'cool') {
				return { validValues: [AUTO, COOL] }
			}
			if (this.userAllowedMode === 'heat') {
				return { validValues: [AUTO,HEAT] }
			}
			return { validValues: [AUTO, HEAT, COOL] }
		})()

		this.aircon
		.getCharacteristic(Characteristic.TargetHeaterCoolerState)
		.setProps(targetHeaterCoolerStateProp as any as HAPNodeJS.CharacteristicProps)
		.on('get', callbackify(this.getMode))
		.on('set', callbackify(this.setMode))

		this.aircon
		.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
		.on('get', callbackify(this.getCurrentHeaterCoolerState))

		if (this.userAllowedMode !== 'cool') {
			this.aircon
			.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.setProps({
				minValue: -10,
				maxValue: 20,
				minStep: 1,
				} as HAPNodeJS.CharacteristicProps)
			.on('get', callbackify(this.getTargetTemperature))
			.on('set', callbackify(this.setTargetTemperature))
		}
		if (this.userAllowedMode !== 'heat') {
		this.aircon
			.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 1,
				} as HAPNodeJS.CharacteristicProps)
			.on('get', callbackify(this.getTargetTemperature))
			.on('set', callbackify(this.setTargetTemperature))
		}

		this.aircon
		.getCharacteristic(Characteristic.RotationSpeed)
		// @ts-ignore
		.setProps({
			format: Characteristic.Formats.INT,
    		unit: undefined,
			minValue: 1,
			maxValue: 4,
			minStep: 1,
			} as HAPNodeJS.CharacteristicProps)
		.on('get', callbackify(this.getRotationSpeed))
		.on('set', callbackify(this.setRotationSpeed))

		this.aircon
		.getCharacteristic(Characteristic.SwingMode)
		.on('get', callbackify(this.getSwingMode))
		.on('set', callbackify(this.setSwingMode))
		
		this.airconFilter
		.getCharacteristic(Characteristic.FilterChangeIndication)
		.on('get', callbackify(this.getFilterChangeIndication))
		
		this.airconFilter
		.getCharacteristic(Characteristic.FilterLifeLevel)
		.setProps({
			unit: Characteristic.Units.PERCENTAGE,
			minValue: 0,
			maxValue: 100,
			minStep: 0.1,
			} as HAPNodeJS.CharacteristicProps)
		.on('get', callbackify(this.getFilterLifeLevel))

		this.infoService
		.setCharacteristic(Characteristic.Manufacturer, 'Samsung')
		.setCharacteristic(Characteristic.Model, "Smart Air Conditioner")
		.setCharacteristic(Characteristic.SerialNumber, "-")
	}

	// e.g. curl -s -k -H "Content-Type: application/json" -H "Authorization: Bearer TOKENXXXXX" --cert /usr/share/ca-certificates/local/ac14k_m.pem --insecure -X GET https://192.168.1.xxx:8888/devices|jq '.Devices[0].Temperatures[0].current
	private genCurlGetStr: (dottedKey?: string) => string
	= (dottedKey) => {
		const last_str = !!dottedKey
			? ` \'.Devices[0].${dottedKey}\'`
			: ` \'.Devices[0]\'`
		const str = this.curlGetPartials.join(' ') + last_str
		return str
	}

	private genCurlSetStr: (request: JsonType, append?: string) => string
	= (request, append) => {
		const post_str = !!append
			? append.startsWith('/')
				? append.substring(1, append.length)
				: append
			: ''
		const str = this.curSetPartials(request, post_str).join(' ')
		return str
	}

	private parseCurlResponse(response: string): JsonType {
		try {
			const res = JSON.parse(response)
			return res as JsonType
		} catch (err) {
			return response.trim()
		}
	}

	public execRequest: (curlCommandString: string) => Promise<JsonType>
	= (curlCommandString) => {
		this.log('execRequest: ' + curlCommandString)
		return new Promise((resolve, reject) => {
			exec(
				curlCommandString,
				(error, stdout, stderr) => {
					if (!error) {
						resolve(this.parseCurlResponse(stdout))
					} else {
						reject(stderr)
					}
				}
			)
		})
	}

	public identify(callback) {
		this.log('Identifying Aircon: ' + this.name)
		callback()
    }

	public getServices: () => HAPNodeJS.Service[]
	= () => {
		/**
		 * Generic
		 * - Active √
		 * - Name
		 * - LockPhysicalControls
		 * 
		 * As 'HeaterCooler':
		 * - CurrentTemperature √		required
		 * - CurrentHeaterCoolerState √	required
		 * - TargetHeaterCoolerState √	required
		 * - CoolingThreshold √
		 * - HeatingThreshold √
		 * - SwingMode √
		 * - TemperatureDisplayUnits
		 * - RotationSpeed √
		 * 
		 * As 'Thermostat':
		 * - CurrentTemperature			required
		 * - TargetTemperature			required
		 * - CurrentHeatingCoolingState	required
		 * - TargetHeatingCoolingState	required
		 * - TemperatureDisplayUnits	required
		 * - CurrentRelativeHumidity
		 * - TargetRelativeHumidity
		 * - CoolingThresholdTemperature
		 * - HeatingThresholdTemperature
		 * 
		 * As 'Fan':
		 * - CurrentFanState
		 * - TargetFanState
		 * - RotationDirection
		 * - RotaltionSpeed
		 * - SwingMode
		 * 
		 * 
		 * As 'FilterMaintenance':
		 * - FilterChangeIndication	√	required
		 * - FilterLifeLevel √
		 * - ResetFilterIndication
		 */
		return [this.infoService, this.aircon, this.airconFilter]
	}

	public getActive: () => Promise<EnumValueLiterals<HbActiveEnum>>
	= async () => {
		const curlStr = this.genCurlGetStr('Operation.power')
		const curlResponse = await this.execRequest(curlStr) as OnOff
			
		if (typeof curlResponse === 'string') { // just to safe-guard response
			const char = Characteristic.Active
			switch (curlResponse) {
				case 'On':
					return char.ACTIVE
				case 'Off':
					return char.INACTIVE
			}
		}
		this.log('Samsung Aircon: invalid power')
		// Other cases: throw as Error
		throw ('invalid-power')
	}

	public setActive: (state: EnumValueLiterals<HbActiveEnum>) => Promise<null>
	= async (state) => {
		const curlStr = this.genCurlSetStr({
			Operation: {
				power: state === Characteristic.Active.ACTIVE
				? 'On'
				: 'Off',
			},
		})
		await this.execRequest(curlStr)
		return null
	}
	
	public getCurrentTemperature: () => Promise<number>
	= async () => {
		const curlStr = this.genCurlGetStr('Temperatures[0].current')
		const curlResponse = await this.execRequest(curlStr) as number
		if (!!curlResponse && typeof curlResponse === 'number') {
			const cur_temp = Math.round(curlResponse * 10) / 10
			/*this.aircon
			.getCharacteristic(Characteristic.CurrentTemperature)
			.updateValue(cur_temp)*/
			return cur_temp
		} else {
			this.log('Samsung Aircon: invalid current temperature')
			throw ('invalid-current-temperature')
		}
	}

	// 'Cool', 'Heat' etc.
	public getMode: () => Promise<EnumValueLiterals<HbTargetHeaterCoolerStateEnum>>
	= async () => {
		const curlStr = this.genCurlGetStr('Mode.modes[0]')
		const curlResponse = await this.execRequest(curlStr) as AirconMode
		const char = Characteristic.TargetHeaterCoolerState
		switch (curlResponse) {
			case 'Auto':
				return char.AUTO
			case 'Cool':
				return char.COOL
			case 'Heat':
				return char.HEAT
			// Homebridge do not have 'Dry' and 'Wind' (Fan)
			// Fallback to 'AUTO'
			case 'Dry':
				return char.AUTO
			case 'Wind':
				return char.AUTO
		}
		this.log('Samsung Aircon: invalid mode')
		throw ('invalid-mode')
	}

	public setMode: (state: EnumValueLiterals<HbTargetHeaterCoolerStateEnum>) => Promise<null>
	= async (state) => {
		const char = Characteristic.TargetHeaterCoolerState
		const curlStr = this.genCurlSetStr({
			modes: [
				(() => {
					switch(state) {
						case char.AUTO:
							return 'Auto'
						case char.COOL:
							return 'Cool'
						case char.HEAT:
							return 'Heat'
						default:
							return 'Auto'
					}
				})() as AirconMode
			],
		}, 'mode')
		await this.execRequest(curlStr)
		return null
	}

	private getIntFromUnderscoredString(str?: string): number {
		if (!str) {
			return NaN
		}
		return parseInt(str.split('_').pop() || '')
	}

	public getSwingMode: () => Promise<EnumValueLiterals<HbSwingModeEnum>>
	= async () => {
		const curlStr = this.genCurlGetStr('Wind.direction')
		const curlResponse = await this.execRequest(curlStr) as Swing
		const char = Characteristic.SwingMode
		switch (curlResponse) {
			case 'Fix':
				return char.SWING_DISABLED
			case 'Up_And_Low':
				return char.SWING_ENABLED
		}
		this.log('Samsung Aircon: invalid swing mode')
		throw ('invalid-swing-mode')
	}

	public setSwingMode: (state: EnumValueLiterals<HbSwingModeEnum>) => Promise<null>
	= async (state) => {
		const char = Characteristic.SwingMode

		const cur_wind_status = await this.execRequest(this.genCurlGetStr('Wind')) as any as Wind
		const curlStr = this.genCurlSetStr(
			Object.assign(cur_wind_status, {
				direction: (() => {
					switch(state) {
						case char.SWING_DISABLED:
							return 'Fix'
						case char.SWING_ENABLED:
							return 'Up_And_Low'
						default:
							return 'Up_And_Low'
					}
				})() as Swing
			}),
			'wind',
		)
		await this.execRequest(curlStr)
		return null
	}

	public getRotationSpeed: () => Promise<number>
	= async () => {
		const curlStr = this.genCurlGetStr('Wind.speedLevel')
		const curlResponse = await this.execRequest(curlStr) as number
		return curlResponse || 0
	}

	public setRotationSpeed: (state: number) => Promise<null>
	= async (state) => {
		const cur_wind_status = await this.execRequest(this.genCurlGetStr('Wind')) as any as Wind
		const { maxSpeedLevel } = cur_wind_status
		const curlStr = this.genCurlSetStr(
			Object.assign(cur_wind_status, {
				speedLevel: (() => {
					if (state < 1) {
						return 1
					}
					if (maxSpeedLevel > 0 && state > maxSpeedLevel) {
						return maxSpeedLevel
					}
					return state
				})()
			}),
			'wind',
		)
		await this.execRequest(curlStr)
		return null
	}

	public getTargetTemperature: () => Promise<number>
	= async () => {
		const curlStr = this.genCurlGetStr('Temperatures[0].desired')
		const curlResponse = await this.execRequest(curlStr) as number
		if (!!curlResponse && typeof curlResponse === 'number') {
			return Math.round(curlResponse)
		} else {
			this.log('Samsung Aircon: invalid target temperature')
			throw ('invalid-target-temperature')
		}
	}

	public setTargetTemperature: (state: number) => Promise<null>
	= async (state) => {
		const curlStr = this.genCurlSetStr({
			desired: state,
		}, 'temperatures/0')
		await this.execRequest(curlStr)
		return null
	}

	public getCurrentHeaterCoolerState: () => Promise<EnumValueLiterals<HbCurrentHeaterCoolerStateEnum>>
	= async () => {
		const curlStr = this.genCurlGetStr('Mode.modes[0]')
		const curlResponse = await this.execRequest(curlStr) as AirconMode
		const char = Characteristic.CurrentHeaterCoolerState
		switch (curlResponse) {
			case 'Auto':
				return char.IDLE
			case 'Cool':
				return char.COOLING
			case 'Heat':
				return char.HEATING
			// Homebridge do not have 'Dry' and 'Wind' (Fan)
			// Fallback to 'AUTO'
			case 'Dry':
				return char.INACTIVE
			case 'Wind':
				return char.INACTIVE
		}
		this.log('Samsung Aircon: invalid current heating cooling state')
		throw ('invalid-current-heating-cooling-state')
	}

	private getFilterStatus: () => Promise<{
		filterTime: number,
		filterAlarmTime: number,
	}> // Promise all in number
	= async () => {
		const curlStr = this.genCurlGetStr('Mode.options')
		const curlResponse = await this.execRequest(curlStr) as AirconModeOption[]
		
		// There is a FilterCleanAlarm_0, but seems not for this purpose...
		// find 'FilterTime_x' etc.
		const FilterTimeStr = curlResponse.find((opt) => opt.startsWith('FilterTime_'))
		const FilterAlarmTimeStr = curlResponse.find((opt) => opt.startsWith('FilterAlarmTime_'))
		
		const filterTime = this.getIntFromUnderscoredString(FilterTimeStr) // This / 10 is hour
		const filterAlarmTime = this.getIntFromUnderscoredString(FilterAlarmTimeStr) // This is in hour
		
		return {
			filterTime: filterTime / 10 || 0,
			filterAlarmTime: filterAlarmTime || 0,
		}
	}

	public getFilterChangeIndication: () => Promise<EnumValueLiterals<HbFilterChangeIndicationEnum>>
	= async () => {
		const { filterTime, filterAlarmTime } = await this.getFilterStatus()
		const alarm = filterAlarmTime > 0 && filterTime >= filterAlarmTime
		const char = Characteristic.FilterChangeIndication
		return alarm ? char.CHANGE_FILTER : char.FILTER_OK
	}

	public getFilterLifeLevel: () => Promise<number>
	= async () => {
		const { filterTime, filterAlarmTime } = await this.getFilterStatus()
		if (!filterAlarmTime || !(filterTime >= 0)) {
			throw ('invalid-filter-time')
		}
		const leftover_percent = (filterAlarmTime - filterTime) / filterAlarmTime * 100
		return leftover_percent >=0 ? leftover_percent : 0
	}
}

export default function(homebridge: any) {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	Accessory = homebridge.hap.Accessory
	//UUIDGen = homebridge.hap.uuid
	homebridge.registerAccessory(
		'homebridge-samsung-air-conditioner',
		'SamsungSmartAirConditioner',
		SamsungAircon,
	)
}