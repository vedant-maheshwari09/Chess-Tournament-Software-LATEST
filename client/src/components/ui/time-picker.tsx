import * as React from "react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface TimePickerProps {
  time?: string | null
  setTime: (time: string) => void
  placeholder?: string
  className?: string
}

export function TimePicker({ time, setTime, placeholder = "Pick a time", className }: TimePickerProps) {
  const [hours, setHours] = React.useState("12")
  const [minutes, setMinutes] = React.useState("00")
  const [period, setPeriod] = React.useState("AM")

  React.useEffect(() => {
    if (time) {
      const [h, m] = time.split(":")
      const hNum = parseInt(h)
      if (hNum === 0) {
        setHours("12")
        setPeriod("AM")
      } else if (hNum === 12) {
        setHours("12")
        setPeriod("PM")
      } else if (hNum > 12) {
        setHours(String(hNum - 12))
        setPeriod("PM")
      } else {
        setHours(String(hNum))
        setPeriod("AM")
      }
      setMinutes(m)
    }
  }, [time])

  const handleTimeChange = (newHours: string, newMinutes: string, newPeriod: string) => {
    let h = parseInt(newHours)
    if (newPeriod === "PM" && h < 12) h += 12
    if (newPeriod === "AM" && h === 12) h = 0
    
    const formattedTime = `${String(h).padStart(2, "0")}:${newMinutes}`
    setTime(formattedTime)
  }

  const hoursOptions = Array.from({ length: 12 }, (_, i) => String(i + 1))
  const minutesOptions = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))

  const displayTime = React.useMemo(() => {
    if (!time) return null
    return `${hours}:${minutes} ${period}`
  }, [time, hours, minutes, period])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal h-10 border-slate-200 bg-white shadow-sm hover:bg-slate-50 transition-all",
            !time && "text-muted-foreground",
            className
          )}
        >
          <Clock className="mr-2 h-4 w-4 text-slate-400" />
          {displayTime ? displayTime : <span className="text-slate-400">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-4 border-slate-200 shadow-xl rounded-xl overflow-hidden animate-in fade-in zoom-in duration-200" align="start">
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase text-slate-400 mb-1 block">Hour</label>
            <Select 
              value={hours} 
              onValueChange={(val) => {
                setHours(val)
                handleTimeChange(val, minutes, period)
              }}
            >
              <SelectTrigger className="h-9 border-slate-200 focus:ring-slate-400">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {hoursOptions.map((h) => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase text-slate-400 mb-1 block">Minute</label>
            <Select 
              value={minutes} 
              onValueChange={(val) => {
                setMinutes(val)
                handleTimeChange(hours, val, period)
              }}
            >
              <SelectTrigger className="h-9 border-slate-200 focus:ring-slate-400">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {minutesOptions.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase text-slate-400 mb-1 block">Period</label>
            <Select 
              value={period} 
              onValueChange={(val) => {
                setPeriod(val)
                handleTimeChange(hours, minutes, val)
              }}
            >
              <SelectTrigger className="h-9 border-slate-200 focus:ring-slate-400">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
