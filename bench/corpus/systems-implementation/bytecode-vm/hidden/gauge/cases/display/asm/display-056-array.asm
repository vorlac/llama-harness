; case display-056-array
; expect exit=0 stdout="[\"\\xff\"]\n"
.func main arity=0 locals=0
  PUSH_INT 255
  CHR
  NEW_ARRAY 1
  PRINT
  RET
.end
