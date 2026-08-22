; case display-037-arraytostr
; expect exit=0 stdout="[]\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  TOSTR
  PRINT
  RET
.end
