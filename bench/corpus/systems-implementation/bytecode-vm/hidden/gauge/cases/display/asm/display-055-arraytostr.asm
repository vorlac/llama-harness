; case display-055-arraytostr
; expect exit=0 stdout="[\"\\x00\"]\n"
.func main arity=0 locals=0
  PUSH_INT 0
  CHR
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
