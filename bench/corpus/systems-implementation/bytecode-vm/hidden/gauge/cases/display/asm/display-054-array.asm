; case display-054-array
; expect exit=0 stdout="[\"\\x00\"]\n"
.func main arity=0 locals=0
  PUSH_INT 0
  CHR
  NEW_ARRAY 1
  PRINT
  RET
.end
