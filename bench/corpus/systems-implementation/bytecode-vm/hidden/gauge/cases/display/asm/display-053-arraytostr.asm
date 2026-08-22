; case display-053-arraytostr
; expect exit=0 stdout="[\"\\r\"]\n"
.func main arity=0 locals=0
  PUSH_STR "\r"
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
